// minha versao: o que o dono do numero apaga SO NO CELULAR (nao chega ao painel como "apagada para todos").
// Decisao do dono: REGISTRAR na Auditoria e ESCONDER do painel (a mensagem/conversa some da tela, o conteudo fica guardado).
// - "Apagar so para mim": o Baileys emite `messages.delete` { keys } (deleteMessageForMe do app state).
// - "Apagar conversa": o Baileys emite `chats.delete` [jid] (deleteChat do app state; ignorado na sincronizacao inicial).
// - "Limpar conversa": o Baileys rc14 NAO emite nada (clearChat so e montado em chatModify, nunca lido em
//   processSyncAction), entao nao ha o que tratar aqui. A tela de Auditoria avisa isso.
import type { WASocket } from "@whiskeysockets/baileys";
import type { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { normalizeJid } from "@/lib/jid-utils";
import { apagandoPeloPainel, montarRegistroAuditoria, nomeDeComMemoria } from "@/lib/auditoria";
import { emSerie } from "@/lib/fila-por-chave";

const QUEM_APAGOU = "Este número (celular)";
const LOTE = 500;

const ehLapide = (m: { extra?: unknown }) => !!(m.extra as any)?.apagada; // "🚫 Esta mensagem foi apagada": ja tem registro proprio

/** Formas conhecidas do chat (telefone e lid): a mensagem pode ter sido salva com qualquer uma. */
async function formasDoChat(dbSessionId: string, jid: string): Promise<string[]> {
    const formas = new Set<string>([jid, normalizeJid(jid)]);
    if (!jid.endsWith("@g.us")) {
        const c = await prisma.contact.findFirst({
            where: { sessionId: dbSessionId, OR: [{ jid }, { lid: jid }] },
            select: { jid: true, lid: true },
        });
        if (c?.jid) formas.add(c.jid);
        if (c?.lid) formas.add(c.lid);
    }
    return [...formas];
}

/** "Apagar so para mim" no celular: registra (origem CELULAR, modo PARA_MIM), tira do banco e avisa a tela. */
export async function tratarApagadasParaMim(p: {
    sessionId: string; dbSessionId: string; io: Server | null;
    keys: { id?: string | null }[];
}) {
    for (const key of p.keys) {
        const keyId = key?.id;
        // eco de quem apagou pelo painel: o painel ja registra e remove por conta propria
        if (!keyId || apagandoPeloPainel(keyId)) continue;
        // sem a mensagem salva nao ha o que registrar (tambem evita registro duplicado no eco)
        const msg = await prisma.message.findFirst({ where: { sessionId: p.dbSessionId, keyId } });
        if (!msg) continue;

        const jaRegistrada = ehLapide(msg)
            || !!(await prisma.auditoria.findFirst({ where: { sessionId: p.sessionId, keyId }, select: { id: true } }));
        if (!jaRegistrada) {
            const linha = await montarRegistroAuditoria({
                sessionKey: p.sessionId, dbSessionId: p.dbSessionId, mensagem: msg,
                origem: "CELULAR", modo: "PARA_MIM", usuarioNome: QUEM_APAGOU,
            });
            await prisma.auditoria.create({ data: linha }); // se falhar, a mensagem NAO e apagada do banco
        }
        await prisma.message.delete({ where: { id: msg.id } }).catch(() => undefined);
        p.io?.to(p.sessionId).emit("message.removed", { sessionKey: p.sessionId, keyId, remoteJid: msg.remoteJid });
        logger.info("Apagadas", `Mensagem ${keyId} apagada so para este numero (celular): registrada e removida do painel.`);
    }
}

/** "Apagar conversa" no celular: registra TODAS as mensagens (acao CONVERSA_APAGADA), apaga do banco e avisa a tela. */
export async function tratarConversasApagadas(p: {
    sessionId: string; dbSessionId: string; io: Server | null; jids: string[];
}) {
    for (const jid of p.jids) {
        if (!jid || jid.endsWith("@broadcast")) continue;
        const formas = await formasDoChat(p.dbSessionId, jid);
        const quando = new Date(); // o mesmo instante em todas as linhas: a tela junta a conversa por ele
        const buscaNome = nomeDeComMemoria(p.dbSessionId);
        let total = 0;
        for (;;) {
            const lote = await prisma.message.findMany({
                where: { sessionId: p.dbSessionId, remoteJid: { in: formas } },
                orderBy: [{ timestamp: "asc" }, { id: "asc" }],
                take: LOTE,
            });
            if (!lote.length) break;
            const aRegistrar = lote.filter((m) => !ehLapide(m));
            if (aRegistrar.length) {
                const linhas = await Promise.all(aRegistrar.map((m) => montarRegistroAuditoria({
                    sessionKey: p.sessionId, dbSessionId: p.dbSessionId, mensagem: m,
                    origem: "CELULAR", modo: "PARA_MIM", usuarioNome: QUEM_APAGOU,
                }, { acao: "CONVERSA_APAGADA", criadoEm: quando, buscaNome })));
                await prisma.auditoria.createMany({ data: linhas }); // se falhar, o lote NAO e apagado e o laco para
            }
            await prisma.message.deleteMany({ where: { id: { in: lote.map((m) => m.id) } } });
            total += aRegistrar.length;
        }
        // os arquivos de midia ficam no disco: a Auditoria guarda o link "abrir o arquivo original"
        for (const f of formas) p.io?.to(p.sessionId).emit("chat.removed", { sessionKey: p.sessionId, jid: f });
        logger.info("Apagadas", `Conversa ${jid} apagada pelo celular: ${total} mensagens registradas e removidas do painel.`);
    }
}

export function bindApagadasCelular(sock: WASocket, sessionId: string, io: Server | null) {
    let dbSessionId: string | null = null;
    const idDoBanco = async () => {
        if (dbSessionId) return dbSessionId;
        const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        dbSessionId = s?.id || null;
        return dbSessionId;
    };
    // uma tarefa de cada vez por sessao (apagar varias mensagens/conversas seguidas nao se atropela)
    const executar = (nome: string, tarefa: (dbId: string) => Promise<void>) => {
        emSerie(`apagadas-celular:${sessionId}`, async () => {
            const dbId = await idDoBanco();
            if (dbId) await tarefa(dbId);
        }).catch((e) => logger.error("Apagadas", `Falha ao tratar ${nome} apagadas pelo celular`, e));
    };

    sock.ev.on("messages.delete", (item) => {
        if (!("keys" in item) || !item.keys?.length) return; // o formato { jid, all } nao e emitido pelo Baileys rc14
        const keys = item.keys;
        executar("mensagens", (dbId) => tratarApagadasParaMim({ sessionId, dbSessionId: dbId, io, keys }));
    });
    sock.ev.on("chats.delete", (jids) => {
        if (!Array.isArray(jids) || !jids.length) return;
        executar("conversas", (dbId) => tratarConversasApagadas({ sessionId, dbSessionId: dbId, io, jids }));
    });
}
