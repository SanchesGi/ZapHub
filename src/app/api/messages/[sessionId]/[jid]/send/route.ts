import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { validarCorpo } from "@/lib/validar";
import { z } from "zod";

const sendSchema = z.object({
    message: z.string().min(1, "mensagem obrigatória").max(65536),
    mentions: z.array(z.string()).optional(),
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
        const result = await ChatService.sendTextMessage(sessionId, jid, message, mentions, quotedMessageId ?? undefined);

        return NextResponse.json({ status: true, message: "Message sent successfully", data: result });
    } catch (error: any) {
        console.error("Send message error:", error);
        const errorMsg = error?.message || "Failed to send message";
        return NextResponse.json({ status: false, message: errorMsg, error: errorMsg }, { status: 500 });
    }
}
