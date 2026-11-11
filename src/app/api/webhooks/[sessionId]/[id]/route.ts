import { NextResponse, NextRequest } from "next/server";
import { buscarSessao } from "@/lib/session-access";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    
    const { sessionId, id } = await params;

    const hasAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { name, url, secret, events, isActive } = body;

        const session = await buscarSessao(sessionId, { id: true });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Verify ownership and session context
        const existing = await prisma.webhook.findFirst({
            where: {
                id,
                OR: [
                    { sessionId: session.id },
                    { sessionId: null, userId: user.id }
                ]
            }
        });

        if (!existing) {
            return NextResponse.json({ status: false, message: "Webhook not found", error: "Webhook not found" }, { status: 404 });
        }

        if (url !== undefined) {
            const { validateSafeUrl } = await import("@/lib/security");
            const urlValidation = await validateSafeUrl(url, { allowHttp: false });
            if (!urlValidation.valid) {
                return NextResponse.json({ status: false, message: `Invalid webhook URL: ${urlValidation.error}`, error: urlValidation.error }, { status: 400 });
            }
        }

        const webhook = await prisma.webhook.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(url !== undefined && { url }),
                ...(secret !== undefined && { secret }),
                ...(events !== undefined && { events }),
                ...(isActive !== undefined && { isActive })
            }
        });

        return NextResponse.json(webhook);
    } catch (error) {
        console.error("Update webhook error:", error);
        return NextResponse.json({ status: false, message: "Failed to update webhook", error: "Failed to update webhook" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    
    const { sessionId, id } = await params;

    const hasAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
    }

    try {
        const session = await buscarSessao(sessionId, { id: true });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const existing = await prisma.webhook.findFirst({
            where: {
                id,
                OR: [
                    { sessionId: session.id },
                    { sessionId: null, userId: user.id }
                ]
            }
        });

        if (!existing) {
            return NextResponse.json({ status: false, message: "Webhook not found", error: "Webhook not found" }, { status: 404 });
        }

        await prisma.webhook.delete({ where: { id } });

        return NextResponse.json({ status: true, message: "Operation successful" });
    } catch (error) {
        console.error("Delete webhook error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete webhook", error: "Failed to delete webhook" }, { status: 500 });
    }
}
