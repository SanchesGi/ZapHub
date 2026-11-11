import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession, podeGerenciarSessao } from "@/lib/api-auth";
import { validateSafeUrl } from "@/lib/security";
import moment from "moment-timezone";

// minha versao (C1): so aceita URL de midia https e que NAO resolva para IP interno/privado.
// Sem isto, o agendamento guardava qualquer texto e o envio (cron.ts) entregava ao Baileys,
// que le arquivo local ("file:"/caminho) ou faz SSRF. Vale para criar e editar agendamento.
async function mediaUrlValida(mediaUrl: unknown): Promise<{ ok: true } | { ok: false; msg: string }> {
    if (mediaUrl === undefined || mediaUrl === null || mediaUrl === "") return { ok: true };
    if (typeof mediaUrl !== "string") return { ok: false, msg: "mediaUrl inválida" };
    const v = await validateSafeUrl(mediaUrl, { allowHttp: false });
    if (!v.valid) return { ok: false, msg: `mídia recusada: ${v.error}` };
    return { ok: true };
}

// GET: List Scheduled Messages
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const url = new URL(request.url);
        const tab = url.searchParams.get("tab") || "pending";
        
        const whereClause: any = { sessionId: session.id };
        let orderByClause: any = { sendAt: 'asc' };
        
        if (tab === "history") {
            whereClause.status = { in: ["SENT", "FAILED"] };
            orderByClause = { sendAt: 'desc' };
        } else {
            whereClause.status = "PENDING";
        }

        const messages = await prisma.scheduledMessage.findMany({
            where: whereClause,
            include: { session: true },
            orderBy: orderByClause
        });

        return NextResponse.json({ status: true, message: "Scheduled messages retrieved successfully", data: messages });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create Scheduled Message
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { jid, content, sendAt, mediaUrl, mediaType, cronExpression, recurrenceRule } = body;

        if (!jid || (!content && !mediaUrl) || !sendAt) {
            return NextResponse.json({ status: false, message: "Missing required fields (JID, Content/Media, SendAt)", error: "Missing required fields" }, { status: 400 });
        }

        const vMedia = await mediaUrlValida(mediaUrl);
        if (!vMedia.ok) return NextResponse.json({ status: false, message: vMedia.msg, error: vMedia.msg }, { status: 400 });

        const canAccess = await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador", error: "Sem permissão: esta ação é só para Supervisor, o dono da sessão ou Super Administrador" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Fetch system timezone
        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";

        console.log(`[Scheduler:POST] Received sendAt: ${sendAt}, using timezone: ${timezone}`);
        const utcDate = moment.tz(sendAt, timezone).toDate();
        console.log(`[Scheduler:POST] Resolved UTC Date: ${utcDate.toISOString()}`);

        const scheduled = await prisma.scheduledMessage.create({
            data: {
                sessionId: session.id,
                jid,
                content,
                mediaUrl,
                mediaType,
                cronExpression,
                recurrenceRule,
                sendAt: utcDate,
                status: "PENDING"
            }
        });

        return NextResponse.json({ status: true, message: "Message scheduled successfully", data: scheduled });

    } catch (error) {
        console.error("Schedule error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }

}

