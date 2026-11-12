import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin, podeGerenciarUsuarios, getAccessibleSessions, idsDaEquipe } from "@/lib/api-auth";

// minha versao: GET /api/auditoria?sessionId=&busca=&origem=&usuarioId=&pagina=&limite=
// Registro de mensagens apagadas (quem apagou, o que era, de quem).
// - Cada um ve so as sessoes a que tem acesso (getAccessibleSessions): o Super Administrador, todas menos as
//   privadas de outros donos; o Supervisor, as dele e as compartilhadas com ele (nao as pessoais da equipe).
// - Sessoes ja apagadas nao aparecem (nao ha mais a quem atribuir o acesso).
export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!podeGerenciarUsuarios(user.role)) return NextResponse.json({ status: false, message: "Somente Supervisor ou Super Administrador" }, { status: 403 });
    const admin = isAdmin(user.role);

    const sp = new URL(req.url).searchParams;
    const sessionId = sp.get("sessionId") || "";
    const busca = (sp.get("busca") || "").trim();
    const origem = sp.get("origem") || "";
    const usuarioId = sp.get("usuarioId") || "";
    const pagina = Math.max(1, parseInt(sp.get("pagina") || "1", 10) || 1);
    const limite = Math.min(100, Math.max(5, parseInt(sp.get("limite") || "25", 10) || 25));

    const e: any[] = [{ acao: "MENSAGEM_APAGADA" }];

    // minha versao: so as sessoes a que a pessoa tem acesso. Antes o Supervisor via tambem as sessoes da equipe
    // (inclusive as pessoais, nao compartilhadas com ele) e o que a equipe apagou em qualquer sessao; o Super
    // Administrador nao ve as sessoes privadas de outros donos (getAccessibleSessions ja filtra).
    let equipe: { id: string; name: string | null; email: string }[] = [];
    if (!admin) {
        const ids = await idsDaEquipe(user.id);
        equipe = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
    }
    const visiveis = await getAccessibleSessions(user.id, user.role);
    const sessoesVisiveis = visiveis.map((s: any) => s.sessionId as string);
    e.push({ sessionId: { in: sessoesVisiveis.length ? sessoesVisiveis : ["__nenhuma__"] } });

    if (sessionId) e.push({ sessionId });
    if (origem) e.push({ origem });
    if (usuarioId) e.push({ usuarioId });
    if (busca) {
        const dig = busca.replace(/\D/g, "");
        e.push({ OR: [
            { conteudo: { contains: busca } },
            { chatNome: { contains: busca } },
            { autorNome: { contains: busca } },
            { usuarioNome: { contains: busca } },
            ...(dig.length >= 3 ? [{ chatJid: { contains: dig } }, { autorJid: { contains: dig } }] : []),
        ] });
    }
    const where = { AND: e };

    const [itens, total, sessoes] = await Promise.all([
        prisma.auditoria.findMany({ where, orderBy: { criadoEm: "desc" }, skip: (pagina - 1) * limite, take: limite }),
        prisma.auditoria.count({ where }),
        prisma.session.findMany({ where: { sessionId: { in: sessoesVisiveis } }, select: { sessionId: true, name: true, user: { select: { name: true, email: true } } } }),
    ]);
    // nome da sessao (e de quem e, para as pessoais da equipe)
    const nomeSessao = new Map(sessoes.map((s) => [s.sessionId, s.name]));
    const donoSessao = new Map(sessoes.map((s) => [s.sessionId, s.user?.name || s.user?.email || null]));

    return NextResponse.json({
        status: true,
        data: itens.map((i) => ({ ...i, sessaoNome: nomeSessao.get(i.sessionId) || i.sessionId, sessaoDono: donoSessao.get(i.sessionId) || null })),
        // pessoas para o filtro "Quem apagou" (Supervisor: a equipe dele; admin: todos)
        pessoas: admin
            ? (await prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }))
            : [{ id: user.id, name: (user as any).name || null, email: (user as any).email }, ...equipe],
        meta: { total, pagina, limite, paginas: Math.max(1, Math.ceil(total / limite)) },
    });
}
