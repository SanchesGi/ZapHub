import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";

// minha versao: validacao no servidor (antes qualquer texto ia direto ao WhatsApp)
const JID_PARTICIPANTE = /^\d{5,20}@(?:s\.whatsapp\.net|lid)$/;
const JID_GRUPO = /^[\w-]{1,64}@g\.us$/;
const corpoMembros = z.object({
    action: z.enum(["add", "remove", "promote", "demote"], { message: "action deve ser add, remove, promote ou demote" }),
    participants: z
        .array(z.string().regex(JID_PARTICIPANTE, "participante inválido: use o JID completo (número@s.whatsapp.net ou @lid)"), { message: "participants deve ser uma lista de JIDs" })
        .min(1, "informe pelo menos 1 participante")
        .max(20, "no máximo 20 participantes por vez"),
});

// PUT: Update group members (add, remove, promote, demote)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);
        if (!JID_GRUPO.test(decodedJid)) {
            return NextResponse.json({ status: false, message: "JID do grupo inválido (deve terminar em @g.us)", error: "JID do grupo inválido (deve terminar em @g.us)" }, { status: 400 });
        }
        const body = await request.json().catch(() => null);
        const corpo = corpoMembros.safeParse(body);
        if (!corpo.success) {
            const motivo = corpo.error.issues[0]?.message || "dados inválidos";
            return NextResponse.json({ status: false, message: `Dados inválidos: ${motivo}`, error: `Dados inválidos: ${motivo}` }, { status: 400 });
        }
        const { action, participants } = corpo.data;

        // Check if user can access this session
        const canAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Execute the action
        const result = await instance.socket.groupParticipantsUpdate(
            decodedJid,
            participants,
            action as any
        );

        return NextResponse.json({ 
            success: true,
            message: `Successfully ${action}ed participants`,
            result
        });

    } catch (error: any) {
        console.error("Update group members error:", error);
        
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to update group members", error: "Bot must be admin to update group members" }, { status: 403 });
        }
        
        if (error.message?.includes("not-authorized")) {
            return NextResponse.json({ status: false, message: "Not authorized to perform this action", error: "Not authorized to perform this action" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to update group members", error: "Failed to update group members" }, { status: 500 });
    }
}
