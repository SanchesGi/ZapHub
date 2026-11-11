import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";

// POST: Block a contact
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);

        // Check if user can access this session
        const canAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Block contact
        await instance.socket.updateBlockStatus(decodedJid, "block");

        return NextResponse.json({ status: true, message: "Contact blocked successfully" });

    } catch (error) {
        console.error("Block contact error:", error);
        return NextResponse.json({ status: false, message: "Failed to block contact", error: "Failed to block contact" }, { status: 500 });
    }
}
