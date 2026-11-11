import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";
import { validarCorpo } from "@/lib/validar";
import { z } from "zod";

const webhookSchema = z.object({
    name: z.string().min(1, "nome obrigatório").max(200),
    url: z.string().url("URL inválida").max(2000),
    secret: z.string().max(500).optional().nullable(),
    events: z.array(z.string()).min(1, "pelo menos 1 evento"),
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    // Verify access to session
    const hasAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
    }

    try {
        // Resolve session string ID to internal ID if needed, or just look up webhooks
        // We need the internal ID to query the Webhook table
        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const webhooks = await prisma.webhook.findMany({
            where: {
                OR: [
                    { sessionId: session.id }, // Specific to this session (anyone who created it)
                    { sessionId: null, userId: user.id } // User's own global webhooks
                ]
            },
            include: {
                session: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ status: true, message: "Webhooks retrieved successfully", data: webhooks });
    } catch (error) {
        console.error("Fetch webhooks error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch webhooks", error: "Failed to fetch webhooks" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    const hasAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
    }

    try {
        const v = await validarCorpo(request, webhookSchema);
        if (!v.ok) return v.resposta;
        const { name, url, secret, events } = v.data;

        const { validateSafeUrl } = await import("@/lib/security");
        const urlValidation = await validateSafeUrl(url, { allowHttp: false });
        if (!urlValidation.valid) {
            return NextResponse.json({ status: false, message: `Invalid webhook URL: ${urlValidation.error}`, error: urlValidation.error }, { status: 400 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const webhook = await prisma.webhook.create({
            data: {
                userId: user.id,
                name,
                url,
                secret: secret || null,
                sessionId: session.id, // Strictly link to this session
                events,
                isActive: true
            }
        });

        return NextResponse.json({ status: true, message: "Webhook created successfully", data: webhook });
    } catch (error: any) {
        console.error("Create webhook error detailed:", error);
        return NextResponse.json({ status: false, message: "Failed to create webhook", error: "Failed to create webhook", details: error.message }, { status: 500 });
    }
}
