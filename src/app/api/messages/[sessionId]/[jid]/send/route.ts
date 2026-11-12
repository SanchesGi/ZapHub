import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { validarCorpo } from "@/lib/validar";
import { z } from "zod";
import { mensagemApiSchema, paraConteudo } from "@/lib/mensagem-api";

const sendSchema = z.object({
    message: mensagemApiSchema, // minha versao: texto puro ou { text } / midia por URL (antes so texto, que quebrava no servico)
    mentions: z.array(z.string().max(200)).max(1000).optional(),
    quotedMessageId: z.string().optional().nullable(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid: rawJid } = await params;
        const jid = decodeURIComponent(rawJid);

        const v = await validarCorpo(request, sendSchema);
        if (!v.ok) return v.resposta;
        const { message, mentions, quotedMessageId } = v.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Send Message using ChatService
        const result = await ChatService.sendTextMessage(sessionId, jid, paraConteudo(message), mentions, quotedMessageId ?? undefined);

        return NextResponse.json({ status: true, message: "Message sent successfully", data: result });
    } catch (error: any) {
        console.error("Send message error:", error);
        // minha versao: erro do filtro de rede pode citar enderecos internos; a resposta leva so o motivo geral
        const bruto = String(error?.message || "");
        const errorMsg = /SSRF|Network fetch|Network read|resolves to|Remote server responded|Download/i.test(bruto)
            ? "Não consegui baixar a mídia da URL informada."
            : bruto || "Failed to send message";
        return NextResponse.json({ status: false, message: errorMsg, error: errorMsg }, { status: 500 });
    }
}
