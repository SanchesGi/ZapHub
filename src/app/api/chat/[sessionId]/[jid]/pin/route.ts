import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { aplicarPeloPainel, sincronizaEstadoChat } from "@/modules/whatsapp/store/estado-chat";

// PUT: Pin or unpin a chat
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
        const { pin } = body;

        if (pin === undefined) {
            return NextResponse.json({ status: false, message: "pin (boolean) is required", error: "pin (boolean) is required" }, { status: 400 });
        }
        
        const decodedJid = decodeURIComponent(jid);

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (sincronizaEstadoChat() && !instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // minha versao: o WhatsApp deixa no maximo 3 conversas fixadas; avisa antes em vez de falhar calado
        const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (pin && dbSession) {
            const fixadas = await prisma.chatEstado.count({ where: { sessionId: dbSession.id, fixadaEm: { not: null }, NOT: { jid: decodedJid } } });
            if (fixadas >= 3) {
                return NextResponse.json({ status: false, message: "O WhatsApp deixa fixar no máximo 3 conversas. Desafixe uma antes.", error: "pin_limit" }, { status: 400 });
            }
        }

        // Pin or unpin chat
        if (sincronizaEstadoChat()) {
            await instance!.socket!.chatModify({ pin: !!pin }, decodedJid);
        }
        const estado = await aplicarPeloPainel(sessionId, decodedJid, { fixadaEm: pin ? new Date() : null });

        return NextResponse.json({
            success: true,
            message: pin ? "Chat pinned successfully" : "Chat unpinned successfully",
            data: estado
        });

    } catch (error) {
        console.error("Pin chat error:", error);
        return NextResponse.json({ status: false, message: "Failed to pin/unpin chat", error: "Failed to pin/unpin chat" }, { status: 500 });
    }
}
