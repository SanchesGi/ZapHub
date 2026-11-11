// minha versao: estado da conversa (arquivada, silenciada, fixada e mensagens fixadas) guardado no banco.
// Fonte unica: os eventos do WhatsApp. O Baileys emite chats.update tanto quando muda no celular quanto quando
// o proprio painel muda (chatModify), e o historico inicial (messaging-history.set) traz o estado de cada conversa.
// Antes o painel so mandava a acao ao WhatsApp e nao guardava nada: a lista mostrava tudo como "normal".
import type { WASocket } from "@whiskeysockets/baileys";
import type { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";
import { logger } from "@/lib/logger";
import { comRetry1020 } from "./groups";

export const SEMPRE = new Date("9999-12-31T00:00:00Z"); // "silenciada para sempre"

/**
 * minha versao: silenciar/fixar/arquivar/lida ficam so no painel, a menos que SINCRONIZAR_ESTADO_CHAT="true".
 * A documentacao do Baileys avisa que chatModify malformado ou inconsistente pode fazer o WhatsApp deslogar todos
 * os aparelhos, e a sessao foi deslogada (401) em producao. Religar so depois de confirmar a causa.
 */
export function sincronizaEstadoChat() {
    return process.env.SINCRONIZAR_ESTADO_CHAT === "true";
}
const MAX_FIXADAS = 3; // limite do WhatsApp por conversa

export type MensagemFixada = { keyId: string; por: string | null; em: string; ate: string | null };

/** O WhatsApp manda instantes em segundos ou em milissegundos conforme a origem; -1 = sempre. */
function paraData(valor: unknown): Date | null | "sempre" {
    if (valor === null || valor === undefined) return null;
    const n = typeof valor === "number" ? valor : Number((valor as any)?.toString?.() ?? valor);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return "sempre";
    if (n === 0) return null;
    return new Date(n > 1e12 ? n : n * 1000);
}

/** @lid -> numero de telefone, quando o contato ja e conhecido (a lista do painel usa o JID de telefone). */
async function jidsDoChat(dbSessionId: string, id: string): Promise<string[]> {
    const jids = new Set<string>([normalizeJid(id)]);
    if (id.endsWith("@lid")) {
        const c = await prisma.contact.findFirst({ where: { sessionId: dbSessionId, lid: id }, select: { jid: true } });
        if (c?.jid) jids.add(c.jid);
    }
    return [...jids];
}

export async function salvarEstado(
    dbSessionId: string,
    jid: string,
    patch: { arquivada?: boolean; silenciadaAte?: Date | null; fixadaEm?: Date | null; fixadas?: MensagemFixada[] }
) {
    const data: any = {};
    if (patch.arquivada !== undefined) data.arquivada = patch.arquivada;
    if (patch.silenciadaAte !== undefined) data.silenciadaAte = patch.silenciadaAte;
    if (patch.fixadaEm !== undefined) data.fixadaEm = patch.fixadaEm;
    if (patch.fixadas !== undefined) data.fixadas = patch.fixadas.length ? patch.fixadas : null;
    // arquivar tira a conversa do topo (o WhatsApp faz o mesmo)
    if (patch.arquivada === true && patch.fixadaEm === undefined) data.fixadaEm = null;
    return comRetry1020(() => prisma.chatEstado.upsert({
        where: { sessionId_jid: { sessionId: dbSessionId, jid } },
        update: data,
        create: { sessionId: dbSessionId, jid, ...data },
    }));
}

/** formato enviado ao navegador */
export function estadoParaTela(e: { arquivada: boolean; silenciadaAte: Date | null; fixadaEm: Date | null } | null | undefined) {
    const agora = Date.now();
    return {
        arquivada: !!e?.arquivada,
        silenciada: !!e?.silenciadaAte && e.silenciadaAte.getTime() > agora,
        silenciadaAte: e?.silenciadaAte && e.silenciadaAte.getTime() > agora ? e.silenciadaAte.toISOString() : null,
        fixada: !!e?.fixadaEm,
        fixadaEm: e?.fixadaEm ? e.fixadaEm.toISOString() : null,
    };
}

export async function estadosDe(dbSessionId: string, jids: string[]) {
    const mapa = new Map<string, ReturnType<typeof estadoParaTela>>();
    if (!jids.length) return mapa;
    const linhas = await prisma.chatEstado.findMany({
        where: { sessionId: dbSessionId, jid: { in: jids } },
        select: { jid: true, arquivada: true, silenciadaAte: true, fixadaEm: true },
    });
    linhas.forEach((l) => mapa.set(l.jid, estadoParaTela(l)));
    return mapa;
}

/** aplica um pedaco de estado vindo do WhatsApp e avisa os paineis abertos */
async function aplicarDoWhatsApp(dbSessionId: string, sessionId: string, io: Server | null, chat: any) {
    if (!chat?.id || chat.id.endsWith("@broadcast") || chat.id === "status@broadcast") return;
    const patch: any = {};
    if (typeof chat.archived === "boolean") patch.arquivada = chat.archived;
    if ("muteEndTime" in chat) {
        const d = paraData(chat.muteEndTime);
        patch.silenciadaAte = d === "sempre" ? SEMPRE : d;
    }
    if ("pinned" in chat) {
        const d = paraData(chat.pinned);
        patch.fixadaEm = d === "sempre" ? new Date() : d;
    }
    if (!Object.keys(patch).length) return;
    for (const jid of await jidsDoChat(dbSessionId, chat.id)) {
        const e = await salvarEstado(dbSessionId, jid, patch);
        io?.to(sessionId).emit("chat.estado", { sessionKey: sessionId, jid, ...estadoParaTela(e) });
    }
}

export function bindEstadoChat(sock: WASocket, sessionId: string, io: Server | null) {
    let dbSessionId: string | null = null;
    const idDoBanco = async () => {
        if (dbSessionId) return dbSessionId;
        const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        dbSessionId = s?.id || null;
        return dbSessionId;
    };
    const aplicarLista = async (lista: any[], origem: string) => {
        const id = await idDoBanco();
        if (!id || !Array.isArray(lista)) return;
        let n = 0;
        for (const chat of lista) {
            try { await aplicarDoWhatsApp(id, sessionId, io, chat); n++; }
            catch (e) { logger.error("Estado", `Falha ao gravar estado da conversa ${chat?.id} (${origem})`, e); }
        }
        if (origem === "historico" && n) logger.info("Estado", `Estado de ${n} conversas sincronizado (sessao ${sessionId})`);
    };

    sock.ev.on("chats.upsert", (chats) => { aplicarLista(chats as any[], "upsert"); });
    sock.ev.on("chats.update", (updates) => { aplicarLista(updates as any[], "update"); });
    sock.ev.on("messaging-history.set", ({ chats }) => { aplicarLista((chats || []) as any[], "historico"); });
}

/**
 * Mensagem fixada/desfixada (pinInChatMessage). tipo 1 = fixar para todos, 2 = desfixar.
 * Guarda no ChatEstado da conversa (ate 3, a mais antiga sai) e avisa a tela.
 */
export async function registrarFixacao(p: {
    dbSessionId: string; sessionId: string; io?: Server | null;
    jid: string; keyId: string; tipo: number; duracaoSeg?: number | null; por: string | null; quando: Date;
}) {
    const jid = normalizeJid(p.jid);
    const atual = await prisma.chatEstado.findUnique({
        where: { sessionId_jid: { sessionId: p.dbSessionId, jid } },
        select: { fixadas: true },
    });
    let lista: MensagemFixada[] = Array.isArray(atual?.fixadas) ? [...(atual!.fixadas as any)] : [];
    lista = lista.filter((f) => f.keyId !== p.keyId);
    if (p.tipo === 1) {
        const ate = p.duracaoSeg && p.duracaoSeg > 0 ? new Date(p.quando.getTime() + p.duracaoSeg * 1000).toISOString() : null;
        lista.unshift({ keyId: p.keyId, por: p.por, em: p.quando.toISOString(), ate });
        lista = lista.slice(0, MAX_FIXADAS);
    }
    await salvarEstado(p.dbSessionId, jid, { fixadas: lista });
    p.io?.to(p.sessionId).emit("chat.fixadas", { sessionKey: p.sessionId, jid, fixadas: lista });
    return lista;
}

/** so as fixacoes que ainda valem (o WhatsApp tira sozinho depois de 24 h, 7 ou 30 dias) */
export function fixadasValidas(fixadas: unknown): MensagemFixada[] {
    if (!Array.isArray(fixadas)) return [];
    const agora = Date.now();
    return (fixadas as MensagemFixada[]).filter((f) => f?.keyId && (!f.ate || new Date(f.ate).getTime() > agora));
}

/**
 * Acao feita pelo painel (depois que o WhatsApp aceitou): grava ja e avisa os paineis abertos.
 * O chats.update que o Baileys emite em seguida grava o mesmo valor (nao duplica nada).
 */
export async function aplicarPeloPainel(sessionKey: string, jid: string, patch: Parameters<typeof salvarEstado>[2]) {
    const s = await prisma.session.findUnique({ where: { sessionId: sessionKey }, select: { id: true } });
    if (!s) return null;
    const e = await salvarEstado(s.id, normalizeJid(jid), patch);
    const tela = estadoParaTela(e);
    (global as any).io?.to(sessionKey).emit("chat.estado", { sessionKey, jid: normalizeJid(jid), ...tela });
    return tela;
}

/** ultima mensagem da conversa no formato que o chatModify (arquivar) pede */
export async function ultimaParaModify(dbSessionId: string, jid: string) {
    const m = await prisma.message.findFirst({
        where: { sessionId: dbSessionId, remoteJid: jid },
        orderBy: { timestamp: "desc" },
        select: { keyId: true, fromMe: true, senderJid: true, timestamp: true },
    });
    if (!m) return [];
    return [{
        key: { remoteJid: jid, id: m.keyId, fromMe: m.fromMe, ...(jid.endsWith("@g.us") && !m.fromMe && m.senderJid ? { participant: m.senderJid } : {}) },
        messageTimestamp: Math.floor(m.timestamp.getTime() / 1000),
    }];
}
