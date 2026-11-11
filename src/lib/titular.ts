// minha versao: LGPD — direitos do titular (um contato do WhatsApp): resumir, exportar e apagar o que o sistema guarda
// sobre uma pessoa em TODAS as sessoes. Acha a pessoa por telefone (com/sem 55 e 9o digito) e tambem pelo jid, lid e
// remoteJidAlt dos contatos. NUNCA fala com o WhatsApp: so apaga dados locais.
import { prisma } from "./prisma";
import { jidsDoTitular, variantesDoTitular } from "./lgpd-puro";
import { apagarArquivosDeMidia } from "./lgpd-midia";

const LOTE = 500;

/** todos os identificadores (jid de telefone, lid, alternativos) e os contatos que casam com o telefone */
export async function identificarTitular(telefone: unknown) {
    const base = jidsDoTitular(telefone);
    if (!base.length) return null;
    const ids = new Set<string>(base);
    // 1a volta: contatos achados pelo telefone; 2a volta: contatos achados pelos lid/alternativos que apareceram
    let contatos: { id: string; sessionId: string; jid: string; lid: string | null; name: string | null; notify: string | null; verifiedName: string | null; remoteJidAlt: string | null; createdAt: Date; updatedAt: Date }[] = [];
    for (let volta = 0; volta < 2; volta++) {
        const lista = [...ids];
        contatos = await prisma.contact.findMany({
            where: { OR: [{ jid: { in: lista } }, { lid: { in: lista } }, { remoteJidAlt: { in: lista } }] },
            select: { id: true, sessionId: true, jid: true, lid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true, createdAt: true, updatedAt: true },
            take: 500,
        });
        const antes = ids.size;
        for (const c of contatos) for (const j of [c.jid, c.lid, c.remoteJidAlt]) if (j) ids.add(j);
        if (ids.size === antes) break;
    }
    return { ids: [...ids], contatos };
}

type Titular = NonNullable<Awaited<ReturnType<typeof identificarTitular>>>;

function filtroMensagens(ids: string[]) {
    // conversa individual com o titular, ou mensagem escrita por ele em grupo
    return { OR: [{ remoteJid: { in: ids } }, { senderJid: { in: ids } }] };
}

async function gruposDoTitular(ids: string[]) {
    const set = new Set(ids);
    const grupos = await prisma.group.findMany({ select: { sessionId: true, jid: true, subject: true, participants: true } });
    return grupos.filter((g) => {
        const p = g.participants;
        return Array.isArray(p) && p.some((x: any) => x && typeof x.id === "string" && set.has(x.id));
    });
}

export async function resumoDoTitular(telefone: unknown) {
    const t = await identificarTitular(telefone);
    if (!t) return null;
    const { ids, contatos } = t;
    const [mensagens, midias, auditoria, grupos, sessoesMsg] = await Promise.all([
        prisma.message.count({ where: filtroMensagens(ids) }),
        prisma.message.count({ where: { AND: [filtroMensagens(ids), { mediaUrl: { not: null } }] } }),
        prisma.auditoria.count({ where: { OR: [{ chatJid: { in: ids } }, { autorJid: { in: ids } }] } }),
        gruposDoTitular(ids),
        prisma.message.findMany({ where: filtroMensagens(ids), select: { sessionId: true }, distinct: ["sessionId"], take: 200 }),
    ]);
    const idsSessao = new Set<string>([...contatos.map((c) => c.sessionId), ...sessoesMsg.map((m) => m.sessionId)]);
    const sessoes = idsSessao.size
        ? await prisma.session.findMany({ where: { id: { in: [...idsSessao] } }, select: { sessionId: true, name: true } })
        : [];
    return {
        sessoes,
        contatos: contatos.length,
        mensagens,
        midias,
        auditoria,
        gruposEmQueAparece: grupos.length,
    };
}

export async function exportarTitular(telefone: unknown) {
    const t = await identificarTitular(telefone);
    if (!t) return null;
    const { ids, contatos } = t;
    const sessoesDb = await prisma.session.findMany({ select: { id: true, sessionId: true, name: true } });
    const nomeDaSessao = new Map(sessoesDb.map((s) => [s.id, { sessionId: s.sessionId, nome: s.name }]));

    const MAX = 20000;
    const mensagens = await prisma.message.findMany({
        where: filtroMensagens(ids), orderBy: { timestamp: "asc" }, take: MAX + 1,
        select: { sessionId: true, remoteJid: true, senderJid: true, fromMe: true, type: true, content: true, mediaUrl: true, timestamp: true, pushName: true },
    });
    const truncado = mensagens.length > MAX;
    if (truncado) mensagens.pop();
    const auditoria = await prisma.auditoria.findMany({
        where: { OR: [{ chatJid: { in: ids } }, { autorJid: { in: ids } }] }, take: 5000,
        select: { sessionId: true, acao: true, origem: true, chatJid: true, autorJid: true, tipo: true, conteudo: true, criadoEm: true },
    });
    const grupos = await gruposDoTitular(ids);
    return {
        geradoEm: new Date().toISOString(),
        identificadores: ids,
        contatos: contatos.map((c) => ({ sessao: nomeDaSessao.get(c.sessionId)?.sessionId ?? null, jid: c.jid, lid: c.lid, remoteJidAlt: c.remoteJidAlt, nome: c.name, apelido: c.notify, nomeVerificado: c.verifiedName, criadoEm: c.createdAt })),
        mensagens: mensagens.map((m) => ({ sessao: nomeDaSessao.get(m.sessionId)?.sessionId ?? null, conversa: m.remoteJid, autor: m.senderJid, enviadaPorMim: m.fromMe, tipo: m.type, texto: m.content, arquivo: m.mediaUrl, data: m.timestamp, nomeExibido: m.pushName })),
        mensagensTruncadas: truncado ? `limite de ${MAX} mensagens` : null,
        midias: mensagens.filter((m) => m.mediaUrl).map((m) => ({ sessao: nomeDaSessao.get(m.sessionId)?.sessionId ?? null, arquivo: m.mediaUrl, tipo: m.type, data: m.timestamp })),
        mensagensApagadasRegistradas: auditoria,
        gruposEmQueAparece: grupos.map((g) => ({ sessao: nomeDaSessao.get(g.sessionId)?.sessionId ?? null, jid: g.jid, nome: g.subject })),
    };
}

export type ResultadoApagarTitular = {
    mensagens: number; midias: number; bytesDeMidia: number; contatos: number; auditoria: number;
    estadosDeConversa: number; etiquetas: number; destinatariosDeEnvioEmMassa: number; agendadas: number; stories: number;
};

/** apaga tudo do titular. Os arquivos de midia saem antes das linhas das mensagens. */
export async function apagarTitular(telefone: unknown): Promise<ResultadoApagarTitular | null> {
    const t = await identificarTitular(telefone);
    if (!t) return null;
    const { ids, contatos } = t;
    const r: ResultadoApagarTitular = { mensagens: 0, midias: 0, bytesDeMidia: 0, contatos: 0, auditoria: 0, estadosDeConversa: 0, etiquetas: 0, destinatariosDeEnvioEmMassa: 0, agendadas: 0, stories: 0 };

    // mensagens, em lotes (e os arquivos de cada lote)
    for (;;) {
        const lote = await prisma.message.findMany({ where: filtroMensagens(ids), select: { id: true, mediaUrl: true }, take: LOTE });
        if (!lote.length) break;
        const a = await apagarArquivosDeMidia(lote.map((m) => m.mediaUrl));
        r.midias += a.arquivos; r.bytesDeMidia += a.bytes;
        await prisma.message.deleteMany({ where: { id: { in: lote.map((m) => m.id) } } });
        r.mensagens += lote.length;
    }

    // registro de mensagens apagadas (guarda texto e midia): tambem e dado do titular
    for (;;) {
        const lote = await prisma.auditoria.findMany({ where: { OR: [{ chatJid: { in: ids } }, { autorJid: { in: ids } }] }, select: { id: true, mediaUrl: true }, take: LOTE });
        if (!lote.length) break;
        const a = await apagarArquivosDeMidia(lote.map((m) => m.mediaUrl));
        r.midias += a.arquivos; r.bytesDeMidia += a.bytes;
        await prisma.auditoria.deleteMany({ where: { id: { in: lote.map((m) => m.id) } } });
        r.auditoria += lote.length;
    }

    const idsContatos = contatos.map((c) => c.id);
    const [, leit, est, lab, dest, ag, st, cont] = await prisma.$transaction([
        prisma.message.updateMany({ where: { contactId: { in: idsContatos } }, data: { contactId: null } }), // sem chave estrangeira pendurada
        prisma.chatLeitura.deleteMany({ where: { jid: { in: ids } } }),
        prisma.chatEstado.deleteMany({ where: { jid: { in: ids } } }),
        prisma.chatLabel.deleteMany({ where: { chatJid: { in: ids } } }),
        prisma.broadcastRecipient.deleteMany({ where: { jid: { in: ids } } }),
        prisma.scheduledMessage.deleteMany({ where: { jid: { in: ids }, status: "PENDING" } }),
        prisma.story.deleteMany({ where: { jid: { in: ids } } }),
        prisma.contact.deleteMany({ where: { id: { in: idsContatos } } }),
    ]);
    r.estadosDeConversa = leit.count + est.count;
    r.etiquetas = lab.count;
    r.destinatariosDeEnvioEmMassa = dest.count;
    r.agendadas = ag.count;
    r.stories = st.count;
    r.contatos = cont.count;
    return r;
}

export { variantesDoTitular };
