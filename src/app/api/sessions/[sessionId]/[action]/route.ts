import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, action: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const resolvedParams = await params;
        const sessionId = resolvedParams.sessionId;
        const action = resolvedParams.action;

        // Verify access
        const canAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
        }

        // Validate Action
        const validActions = ["start", "stop", "restart", "logout", "pair"];
        if (!validActions.includes(action)) {
            return NextResponse.json({ status: false, message: "Invalid action", error: "Invalid action" }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));

        switch (action) {
            case "pair":
                const { phoneNumber } = body;
                if (!phoneNumber) {
                    return NextResponse.json({ status: false, message: "Phone number required for pairing" }, { status: 400 });
                }
                const pairingCode = await waManager.requestPairingCode(sessionId, phoneNumber);
                return NextResponse.json({ status: true, message: "Pairing code generated", data: { pairingCode } });

            case "start":
                await waManager.startSession(sessionId);
                break;
            case "stop":
                await waManager.stopSession(sessionId);
                break;
            case "restart":
                await waManager.restartSession(sessionId);
                break;
            case "logout":
                // Retrieve instance to logout properly
                // minha versao: desloga de verdade mesmo se a sessao estiver no meio de uma reconexao
                const instance = waManager.getInstance(sessionId);
                let deslogouNoWhatsApp = false;
                if (instance?.socket && instance.status === "CONNECTED") {
                    try { await instance.socket.logout(); deslogouNoWhatsApp = true; } catch { /* cai no plano B */ }
                }
                if (!deslogouNoWhatsApp) {
                    if (instance) { await instance.shutdown(); waManager.removeInstance(sessionId); }
                    await prisma.$transaction([
                        prisma.session.update({ where: { sessionId }, data: { status: "LOGGED_OUT", qr: null } }),
                        prisma.authState.deleteMany({ where: { sessionId } }),
                    ]);
                }
                break;
        }

        return NextResponse.json({ status: true, message: `Session ${action}ed successfully` });

    } catch (error) {
        console.error("Session action error:", error);
        return NextResponse.json({ error: `Failed to ${(error as any).message || "perform action"}` }, { status: 500 });
    }
}
