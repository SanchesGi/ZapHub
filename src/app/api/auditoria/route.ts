import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { idsDaEquipe } from "@/lib/api-auth";
import { acessoDaAuditoria } from "@/lib/auditoria-acesso";
import {
    ACAO_CONVERSA, ACAO_MENSAGEM, chaveDoGrupo, condicaoDoTipo, ehPeriodo, ehTipoFiltro, inicioDoPeriodo,
    mesclarPagina, type TipoFiltro,
} from "@/lib/auditoria-tela";

// minha versao: GET /api/auditoria?sessionId=&busca=&tipo=&usuarioId=&periodo=&fuso=&pagina=&limite=
// Registro de mensagens apagadas (quem apagou, o que era, de quem) e das conversas apagadas pelo celular.
// - tipo: PAINEL | CELULAR | CONTATO | CONVERSA (CONVERSA = "Conversa apagada"); `origem` (PAINEL|CELULAR|CONTATO) segue valendo.
// - periodo: hoje | 7d | 30d | tudo; fuso = Date.getTimezoneOffset() do navegador (para "hoje" comecar na meia-noite dele).
// - As linhas de uma conversa apagada (uma por mensagem) voltam como UM item { tipoItem: "conversa", total }.
// - Acesso: so quem acessoDaAuditoria deixa e so as sessoes a que a pessoa tem acesso. Sessoes ja apagadas nao aparecem.
const PROFUNDIDADE_MAX = 5000; // mensagens mais novas que a paginacao alcanca (o resto se acha com os filtros)
const GRUPOS_MAX = 2000;

const invalido = (message: string) => NextResponse.json({ status: false, message }, { status: 400 });

export async function GET(req: NextRequest) {
    const acesso = await acessoDaAuditoria(req);
    if ("erro" in acesso) return acesso.erro;
    const { user, admin, sessoesVisiveis } = acesso;

    const sp = new URL(req.url).searchParams;
    const sessionId = (sp.get("sessionId") || "").slice(0, 120);
    const busca = (sp.get("busca") || "").trim().slice(0, 200);
    const usuarioId = (sp.get("usuarioId") || "").slice(0, 60);
    const limite = Math.min(100, Math.max(5, parseInt(sp.get("limite") || "25", 10) || 25));
    const paginaMax = Math.max(1, Math.floor(PROFUNDIDADE_MAX / limite));
    const pagina = Math.min(paginaMax, Math.max(1, parseInt(sp.get("pagina") || "1", 10) || 1));

    const periodo = sp.get("periodo") || "tudo";
    if (!ehPeriodo(periodo)) return invalido("Período inválido (use hoje, 7d, 30d ou tudo)");
    const tipoTexto = sp.get("tipo") || sp.get("origem") || "";
    if (tipoTexto && !ehTipoFiltro(tipoTexto)) return invalido("Tipo inválido (use PAINEL, CELULAR, CONTATO ou CONVERSA)");
    const tipo: TipoFiltro | null = tipoTexto ? (tipoTexto as TipoFiltro) : null;
    const fuso = parseInt(sp.get("fuso") || "0", 10);
    if (!Number.isFinite(fuso) || Math.abs(fuso) > 14 * 60) return invalido("Fuso inválido");

    // minha versao: so as sessoes a que a pessoa tem acesso. Antes o Supervisor via tambem as sessoes da equipe
    // (inclusive as pessoais, nao compartilhadas com ele) e o que a equipe apagou em qualquer sessao; o Super
    // Administrador nao ve as sessoes privadas de outros donos (getAccessibleSessions ja filtra).
    let equipe: { id: string; name: string | null; email: string }[] = [];
    if (!admin) {
        const ids = await idsDaEquipe(user.id);
        equipe = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
    }

    const comuns: any[] = [{ sessionId: { in: sessoesVisiveis.length ? sessoesVisiveis : ["__nenhuma__"] } }];
    if (sessionId) comuns.push({ sessionId });
    if (usuarioId) comuns.push({ usuarioId });
    const inicio = inicioDoPeriodo(periodo, new Date(), fuso);
    if (inicio) comuns.push({ criadoEm: { gte: inicio } });
    if (busca) {
        const dig = busca.replace(/\D/g, "");
        comuns.push({ OR: [
            { conteudo: { contains: busca } },
            { chatNome: { contains: busca } },
            { autorNome: { contains: busca } },
            { usuarioNome: { contains: busca } },
            ...(dig.length >= 3 ? [{ chatJid: { contains: dig } }, { autorJid: { contains: dig } }] : []),
        ] });
    }
    const onde = (acao: string) => ({ AND: [{ acao }, ...(tipo ? [condicaoDoTipo(tipo)] : []), ...comuns] });
    // cada tipo pertence a UMA das duas listas: mensagens soltas ou conversas apagadas
    const querSoltas = tipo !== "CONVERSA";
    const querConversas = !tipo || tipo === "CONVERSA";
    const ondeSoltas = onde(ACAO_MENSAGEM);
    const ondeConversas = onde(ACAO_CONVERSA);

    // conversas apagadas: uma linha por mensagem no banco; aqui viram um item por conversa (mesma sessao + conversa + instante)
    const grupos = querConversas
        ? (await prisma.auditoria.groupBy({
            by: ["sessionId", "chatJid", "criadoEm"], where: ondeConversas, _count: { _all: true },
            orderBy: { criadoEm: "desc" }, take: GRUPOS_MAX,
        })).map((g) => ({ sessionId: g.sessionId, chatJid: g.chatJid, criadoEm: g.criadoEm, total: g._count._all }))
        : [];

    const totalSoltas = querSoltas ? await prisma.auditoria.count({ where: ondeSoltas }) : 0;
    type Grupo = (typeof grupos)[number];
    let pedaco: ({ tipo: "mensagem"; item: any } | { tipo: "conversa"; item: Grupo })[];
    if (grupos.length === 0) {
        const soltas = querSoltas ? await prisma.auditoria.findMany({ where: ondeSoltas, orderBy: { criadoEm: "desc" }, skip: (pagina - 1) * limite, take: limite }) : [];
        pedaco = soltas.map((item) => ({ tipo: "mensagem" as const, item }));
    } else {
        const soltas = querSoltas ? await prisma.auditoria.findMany({ where: ondeSoltas, orderBy: { criadoEm: "desc" }, take: pagina * limite }) : [];
        pedaco = mesclarPagina(soltas, grupos, pagina, limite);
    }

    // uma linha de amostra de cada conversa apagada desta pagina (nome da conversa, quem apagou)
    const gruposDaPagina = pedaco.flatMap((p) => (p.tipo === "conversa" ? [p.item] : []));
    const amostras = gruposDaPagina.length
        ? await prisma.auditoria.findMany({
            where: { acao: ACAO_CONVERSA, OR: gruposDaPagina.map((g) => ({ sessionId: g.sessionId, chatJid: g.chatJid, criadoEm: g.criadoEm })) },
            distinct: ["sessionId", "chatJid", "criadoEm"],
            orderBy: { enviadaEm: "asc" },
        })
        : [];
    const amostraDe = new Map(amostras.map((a) => [chaveDoGrupo(a), a]));

    const sessoes = await prisma.session.findMany({ where: { sessionId: { in: sessoesVisiveis } }, select: { sessionId: true, name: true, user: { select: { name: true, email: true } } } });
    // nome da sessao (e de quem e, para as pessoais da equipe)
    const nomeSessao = new Map(sessoes.map((s) => [s.sessionId, s.name]));
    const donoSessao = new Map(sessoes.map((s) => [s.sessionId, s.user?.name || s.user?.email || null]));
    const dadosDaSessao = (id: string) => ({ sessaoNome: nomeSessao.get(id) || id, sessaoDono: donoSessao.get(id) || null });

    const data = pedaco.flatMap((p) => {
        if (p.tipo === "mensagem") return [{ ...p.item, tipoItem: "mensagem" as const, ...dadosDaSessao(p.item.sessionId) }];
        const a = amostraDe.get(chaveDoGrupo(p.item));
        if (!a) return [];
        // o conteudo das mensagens so vem no "ver mensagens" (/api/auditoria/conversa), nao nesta lista
        return [{
            ...a, id: chaveDoGrupo(p.item), tipoItem: "conversa" as const, total: p.item.total,
            keyId: null, conteudo: null, mediaUrl: null, tipo: null, autorJid: null, autorNome: null, fromMe: false, enviadaEm: null,
            ...dadosDaSessao(a.sessionId),
        }];
    });

    const total = totalSoltas + grupos.length;
    return NextResponse.json({
        status: true,
        data,
        // pessoas para o filtro "Quem apagou" (Supervisor: a equipe dele; admin: todos)
        pessoas: admin
            ? (await prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }))
            : [{ id: user.id, name: (user as any).name || null, email: (user as any).email }, ...equipe],
        meta: { total, pagina, limite, paginas: Math.min(paginaMax, Math.max(1, Math.ceil(total / limite))), truncado: total > paginaMax * limite },
    });
}
