import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { aplicarPeloPainel, ultimaParaModify, sincronizaEstadoChat } from "@/modules/whatsapp/store/estado-chat";

// PUT: Archive or unarchive chat
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
        const body = await request.json();
        const { archive } = body;

        if (archive === undefined) {
            return NextResponse.json({ status: false, message: "archive (boolean) is required", error: "archive (boolean) is required" }, { status: 400 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (sincronizaEstadoChat() && !instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);

        // minha versao: o WhatsApp usa a ultima mensagem para saber ate onde a conversa foi arquivada
        // (com a lista vazia o celular podia ignorar). E agora o painel guarda o estado.
        if (sincronizaEstadoChat()) {
            const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            const lastMessages = dbSession ? await ultimaParaModify(dbSession.id, decodedJid) : [];
            // sem a ultima mensagem nao envia: lista vazia e justamente o caso que pode deslogar a conta
            if (lastMessages.length) {
                await instance!.socket!.chatModify({ archive: !!archive, lastMessages }, decodedJid);
            }
        }
        const estado = await aplicarPeloPainel(sessionId, decodedJid, { arquivada: !!archive });

        return NextResponse.json({
            success: true,
            message: archive ? "Chat archived" : "Chat unarchived",
            data: estado
        });

    } catch (error) {
        console.error("Archive chat error:", error);
        return NextResponse.json({ status: false, message: "Failed to archive/unarchive chat", error: "Failed to archive/unarchive chat" }, { status: 500 });
    }
}
