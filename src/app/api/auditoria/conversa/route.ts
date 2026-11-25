import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { acessoDaAuditoria } from "@/lib/auditoria-acesso";
import { ACAO_CONVERSA, lerDataIso } from "@/lib/auditoria-tela";

// minha versao: GET /api/auditoria/conversa?sessionId=&chatJid=&em=<instante ISO do grupo>&pagina=
// As mensagens de UMA conversa apagada pelo celular (botao "ver mensagens" do cartao), da mais antiga para a mais nova.
// Mesmo acesso da lista: so Supervisor/Super Administrador e so as sessoes a que a pessoa tem acesso.
const POR_PAGINA = 50;

export async function GET(req: NextRequest) {
    const acesso = await acessoDaAuditoria(req);
    if ("erro" in acesso) return acesso.erro;

    const sp = new URL(req.url).searchParams;
    const sessionId = sp.get("sessionId") || "";
    const chatJid = sp.get("chatJid") || "";
    const em = lerDataIso(sp.get("em"));
    if (!sessionId || !chatJid || chatJid.length > 200 || !em) {
        return NextResponse.json({ status: false, message: "Parâmetros inválidos (sessionId, chatJid e em)" }, { status: 400 });
    }
    if (!acesso.sessoesVisiveis.includes(sessionId)) {
        return NextResponse.json({ status: false, message: "Sem acesso a esta sessão" }, { status: 403 });
    }
    const pagina = Math.max(1, parseInt(sp.get("pagina") || "1", 10) || 1);

    const where = { acao: ACAO_CONVERSA, sessionId, chatJid, criadoEm: em };
    const [itens, total] = await Promise.all([
        prisma.auditoria.findMany({ where, orderBy: [{ enviadaEm: "asc" }, { id: "asc" }], skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
        prisma.auditoria.count({ where }),
    ]);
    return NextResponse.json({ status: true, data: itens, meta: { total, pagina, temMais: pagina * POR_PAGINA < total } });
}
