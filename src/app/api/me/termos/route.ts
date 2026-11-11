// minha versao: LGPD — aceite dos Termos de Uso + Politica de Privacidade (um aceite so, com versao).
// Fica em /api/me/termos (e nao em /api/auth/*, que pula a autenticacao no proxy).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { VERSAO_TERMOS, VIGENCIA_TERMOS } from "@/lib/termos";

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { termosVersao: true } });
    const versaoAceita = dbUser?.termosVersao ?? null;
    const ultimo = versaoAceita
        ? await prisma.aceiteTermos.findFirst({ where: { userId: user.id, versao: versaoAceita }, orderBy: { aceitoEm: "desc" }, select: { aceitoEm: true } })
        : null;
    return NextResponse.json({
        status: true,
        data: {
            versaoAtual: VERSAO_TERMOS,
            vigencia: VIGENCIA_TERMOS,
            versaoAceita,
            aceitoEm: ultimo?.aceitoEm ?? null,
            precisaAceitar: versaoAceita !== VERSAO_TERMOS,
        },
    });
}

export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    // o aceite e de uma pessoa, feito na tela: chave de API nao aceita pela pessoa
    if (user.authMethod !== "session") {
        return NextResponse.json({ status: false, message: "O aceite precisa ser feito pelo painel" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.versao !== VERSAO_TERMOS) {
        return NextResponse.json({ status: false, error: "versao_invalida", message: "Esta não é a versão atual dos termos. Recarregue a página." }, { status: 400 });
    }

    const ip = ipDeHeaders(req.headers);
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 500) || null;
    await prisma.$transaction([
        prisma.aceiteTermos.create({ data: { userId: user.id, versao: VERSAO_TERMOS, ip, userAgent } }),
        prisma.user.update({ where: { id: user.id }, data: { termosVersao: VERSAO_TERMOS } }),
    ]);
    await registrarAcesso({ tipo: "TERMOS_ACEITOS", usuarioId: user.id, usuarioEmail: user.email, ip, detalhe: `versao ${VERSAO_TERMOS}` });
    return NextResponse.json({ status: true, message: "Termos aceitos" });
}
