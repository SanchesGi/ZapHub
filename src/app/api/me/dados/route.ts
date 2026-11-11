// minha versao: LGPD — o usuario baixa os PROPRIOS dados (JSON). Sem senha/hash, sem chave de API completa,
// sem segredo do 2FA, sem segredo de webhook.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

const LIMITE_LOGS = 5000;

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const conta = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true, twoFactorEnabled: true, termosVersao: true, apiKey: true, supervisorId: true },
    });
    if (!conta) return NextResponse.json({ status: false, message: "Usuário não encontrado" }, { status: 404 });
    const { apiKey, ...contaSemChave } = conta;

    const [aceites, logs, sessoes, acessos, notificacoes, webhooks, mensagensEnviadas] = await Promise.all([
        prisma.aceiteTermos.findMany({ where: { userId: user.id }, orderBy: { aceitoEm: "asc" }, select: { versao: true, aceitoEm: true, ip: true, userAgent: true } }),
        prisma.logAcesso.findMany({
            where: { OR: [{ usuarioId: user.id }, { usuarioEmail: conta.email }] },
            orderBy: { quando: "desc" }, take: LIMITE_LOGS,
            select: { quando: true, tipo: true, alvo: true, ip: true, detalhe: true },
        }),
        prisma.session.findMany({ where: { userId: user.id }, select: { name: true, sessionId: true, status: true, createdAt: true } }),
        prisma.sessionAccess.findMany({ where: { userId: user.id }, select: { createdAt: true, session: { select: { name: true, sessionId: true } } } }),
        prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 2000, select: { title: true, message: true, type: true, read: true, createdAt: true } }),
        prisma.webhook.findMany({ where: { userId: user.id }, select: { name: true, url: true, events: true, isActive: true, createdAt: true } }),
        conta.name ? prisma.message.count({ where: { sentBy: conta.name } }) : Promise.resolve(0),
    ]);

    const dados = {
        geradoEm: new Date().toISOString(),
        conta: { ...contaSemChave, chaveApi: apiKey ? { definida: true, final: apiKey.slice(-4) } : { definida: false } },
        aceitesDosTermos: aceites,
        registrosDeAcesso: { total: logs.length, limite: LIMITE_LOGS, itens: logs },
        sessoesDoWhatsApp: sessoes,
        sessoesCompartilhadasComigo: acessos.map((a: { createdAt: Date; session: { name: string; sessionId: string } }) => ({ desde: a.createdAt, nome: a.session.name, sessionId: a.session.sessionId })),
        webhooks,
        notificacoes,
        mensagensEnviadasPorMim: mensagensEnviadas,
    };
    return new NextResponse(JSON.stringify(dados, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"meus-dados-zaphub.json\"",
            "Cache-Control": "no-store",
        },
    });
}
