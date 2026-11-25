// minha versao: download de midia FORA do caminho de gravacao da mensagem.
// Antes: cada mensagem esperava o download terminar para ser gravada, sem tempo limite e sem nova tentativa.
// Um download lento travava a fila inteira (historico e mensagens novas) e um download que falhava deixava
// a mensagem sem arquivo para sempre (a imagem "sumia"). Agora:
//  - mensagem ao vivo tenta baixar na hora com tempo limite; se nao der, grava sem arquivo e entra na fila;
//  - historico grava direto e a midia vem pela fila;
//  - a fila tenta de novo (30 s, 2 min, 10 min) pedindo ao WhatsApp para reenviar a midia vencida;
//  - midia enviada pelo painel usa o proprio arquivo enviado (nao baixa de volta do WhatsApp);
//  - o que falhar de vez fica marcado na mensagem e a tela oferece "tentar de novo".
import { BufferJSON, type WAMessage } from "@whiskeysockets/baileys";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { statusVigente } from "./status-puro";

// ---- midia enviada pelo painel (keyId -> arquivo) ----
type Enviada = { buffer: Buffer; mimetype?: string; expira: number };
const enviadas: Map<string, Enviada> = ((globalThis as any).__waMidiaEnviada ??= new Map());

export function guardarMidiaEnviada(keyId: string, buffer: Buffer, mimetype?: string) {
    const agora = Date.now();
    for (const [k, v] of enviadas) if (v.expira < agora) enviadas.delete(k);
    enviadas.set(keyId, { buffer, mimetype, expira: agora + 10 * 60_000 });
}

export function pegarMidiaEnviada(keyId?: string | null): Enviada | null {
    if (!keyId) return null;
    const e = enviadas.get(keyId);
    if (!e) return null;
    enviadas.delete(keyId);
    return e.expira > Date.now() ? e : null;
}

// ---- descritor guardado na mensagem para tentar de novo depois (inclusive apos reiniciar) ----
export const TIPOS_MIDIA = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER"];

export function descritorMidia(msg: WAMessage) {
    // so o que o download precisa: sem miniaturas (pesam no banco) e sem contextInfo (texto citado, mencoes e
    // numeros de outras pessoas, que a exclusao de dados de um titular nao alcancaria aqui dentro)
    const FORA = new Set(["jpegThumbnail", "thumbnail", "pngThumbnail", "contextInfo"]);
    const m = JSON.stringify(msg.message, (k, v) => (FORA.has(k) ? undefined : BufferJSON.replacer(k, v)));
    return { key: msg.key, m };
}

/**
 * minha versao: o que a TELA recebe de `extra`. Os dados de download (chave da midia no WhatsApp) ficam so no
 * servidor; a tela so precisa saber se a midia esta baixando ou se falhou (para o botao "tentar de novo").
 */
export function extraParaTela(extra: any): any {
    if (!extra || typeof extra !== "object") return extra;
    // minha versao: tambem ficam so no servidor a chave da enquete (enqueteSegredo) e os recibos por participante
    // (recibos: pesado em grupo grande; a tela pede pelo "Info da mensagem")
    const { midiaOrigem, midiaPendente, enqueteSegredo, recibos, ...resto } = extra;
    void midiaOrigem; void enqueteSegredo; void recibos;
    return midiaPendente ? { ...resto, midiaPendente: { falhou: !!midiaPendente.falhou } } : resto;
}

export function mensagemDoDescritor(d: any): WAMessage | null {
    try {
        if (!d?.key || !d?.m) return null;
        return { key: d.key, message: JSON.parse(d.m, BufferJSON.reviver) } as WAMessage;
    } catch {
        return null;
    }
}

// ---- fila ----
// minha versao: prioridade = mensagem ao vivo passa na frente do historico (antes esperava centenas de midias antigas)
// minha versao: alvo "story" = a midia e de um STATUS (tabela Story, nao Message); `aoTerminar` recebe o arquivo (ou null se desistiu)
type Tarefa = {
    sessionId: string; dbSessionId: string; msg: WAMessage; tentativa: number; prioridade?: boolean;
    alvo?: "story"; aoTerminar?: (url: string | null) => void;
};
const ESPERAS_MS = [0, 30_000, 2 * 60_000, 10 * 60_000];
const SIMULTANEOS = 3;
const TEMPO_LIMITE_MS = 45_000;
// minha versao: o historico de status pode trazer centenas de midias de uma vez; passando disso, o excedente nao entra na fila
// (o status fica sem a imagem, marcado como "falhou") para a memoria e a rede nao dispararem
const MAX_STATUS_NA_FILA = 150;

const estado: { fila: Tarefa[]; rodando: number; naFila: Set<string> } =
    ((globalThis as any).__waMidiaFila ??= { fila: [], rodando: 0, naFila: new Set<string>() });

function idDaTarefa(t: Pick<Tarefa, "sessionId" | "msg" | "alvo">): string {
    return `${t.alvo === "story" ? "story:" : ""}${t.sessionId}:${t.msg.key.id}`;
}

export function agendarDownload(t: Omit<Tarefa, "tentativa"> & { tentativa?: number }) {
    const id = idDaTarefa(t);
    const tentativa = t.tentativa ?? 0;
    if (tentativa === 0 && estado.naFila.has(id)) return; // ja esta na fila
    if (t.alvo === "story" && tentativa === 0 && estado.fila.filter((x) => x.alvo === "story").length >= MAX_STATUS_NA_FILA) {
        logger.warn("Media", `Fila de midia de status cheia (${MAX_STATUS_NA_FILA}); a midia de ${t.msg.key.id} nao sera baixada.`);
        marcarStoryFalhou(t).catch((e) => logger.error("Media", "Erro ao marcar a midia do status como falha", e));
        t.aoTerminar?.(null);
        return;
    }
    estado.naFila.add(id);
    const espera = ESPERAS_MS[Math.min(tentativa, ESPERAS_MS.length - 1)];
    setTimeout(() => {
        if (t.prioridade) estado.fila.unshift({ ...t, tentativa });
        else estado.fila.push({ ...t, tentativa });
        rodar();
    }, espera);
}

function rodar() {
    while (estado.rodando < SIMULTANEOS && estado.fila.length) {
        const t = estado.fila.shift()!;
        estado.rodando++;
        processar(t).finally(() => { estado.rodando--; rodar(); });
    }
}

async function processar(t: Tarefa) {
    if (t.alvo === "story") return processarStory(t);
    const id = idDaTarefa(t);
    const keyId = t.msg.key.id!;
    try {
        const { downloadAndSaveMedia } = await import("./webhook");
        const { waManager } = await import("@/modules/whatsapp/manager");
        const sock = waManager.getInstance(t.sessionId)?.socket || undefined;
        const url = await downloadAndSaveMedia(t.msg, t.sessionId, { sock, timeoutMs: TEMPO_LIMITE_MS });

        if (url) {
            const atual = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: t.dbSessionId, keyId } }, select: { extra: true } });
            const extra: any = atual?.extra && typeof atual.extra === "object" ? { ...(atual.extra as any) } : {};
            // guarda os dados de download: se o arquivo sumir do disco, da para baixar de novo pela tela
            extra.midiaOrigem = extra.midiaPendente ? { key: extra.midiaPendente.key, m: extra.midiaPendente.m } : descritorMidia(t.msg);
            delete extra.midiaPendente;
            const m = await prisma.message.update({
                where: { sessionId_keyId: { sessionId: t.dbSessionId, keyId } },
                data: { mediaUrl: url, extra: Object.keys(extra).length ? extra : null as any },
            });
            emitir(t.sessionId, m);
            estado.naFila.delete(id);
            if (t.tentativa > 0) logger.success("Media", `Midia de ${keyId} baixada na tentativa ${t.tentativa + 1}`);
            return;
        }
        throw new Error("download sem resultado");
    } catch (e: any) {
        const proxima = t.tentativa + 1;
        if (proxima < ESPERAS_MS.length) {
            logger.warn("Media", `Midia de ${keyId} nao baixou (${e?.message || e}). Nova tentativa ${proxima + 1}/${ESPERAS_MS.length}.`);
            agendarDownload({ ...t, tentativa: proxima });
            return;
        }
        estado.naFila.delete(id);
        logger.error("Media", `Midia de ${keyId} nao baixou depois de ${ESPERAS_MS.length} tentativas. Fica o botao "tentar de novo".`);
        try {
            const atual = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: t.dbSessionId, keyId } }, select: { extra: true } });
            const extra: any = atual?.extra && typeof atual.extra === "object" ? { ...(atual.extra as any) } : {};
            extra.midiaPendente = { ...(extra.midiaPendente || descritorMidia(t.msg)), falhou: true };
            const m = await prisma.message.update({ where: { sessionId_keyId: { sessionId: t.dbSessionId, keyId } }, data: { extra } });
            emitir(t.sessionId, m);
        } catch { /* mensagem apagada no meio do caminho */ }
    }
}

// minha versao: download da midia de um STATUS (mesma fila e mesmos limites das mensagens, prioridade baixa)
async function processarStory(t: Tarefa) {
    const id = idDaTarefa(t);
    const keyId = t.msg.key.id!;
    try {
        const story = await prisma.story.findFirst({
            where: { sessionId: t.dbSessionId, keyId },
            select: { id: true, mediaUrl: true, expiraEm: true, timestamp: true, fromMe: true },
        });
        // apagado, vencido ou ja com arquivo: nada a baixar
        if (!story || story.mediaUrl || !statusVigente({ criadoEm: story.timestamp, expiraEm: story.expiraEm })) {
            estado.naFila.delete(id);
            return;
        }
        const { downloadAndSaveMedia } = await import("./webhook");
        const { waManager } = await import("@/modules/whatsapp/manager");
        const sock = waManager.getInstance(t.sessionId)?.socket || undefined;
        const url = await downloadAndSaveMedia(t.msg, t.sessionId, { sock, timeoutMs: TEMPO_LIMITE_MS });
        if (!url) throw new Error("download sem resultado");

        await prisma.story.update({ where: { id: story.id }, data: { mediaUrl: url, extra: { midiaOrigem: descritorMidia(t.msg) } as any } });
        estado.naFila.delete(id);
        (global as any).io?.to(t.sessionId).emit("status.update", { sessionKey: t.sessionId, acao: "midia", id: story.id, fromMe: story.fromMe, live: true });
        t.aoTerminar?.(url);
    } catch (e: any) {
        const proxima = t.tentativa + 1;
        if (proxima < ESPERAS_MS.length) {
            logger.warn("Media", `Midia do status ${keyId} nao baixou (${e?.message || e}). Nova tentativa ${proxima + 1}/${ESPERAS_MS.length}.`);
            agendarDownload({ ...t, tentativa: proxima });
            return;
        }
        estado.naFila.delete(id);
        logger.error("Media", `Midia do status ${keyId} nao baixou depois de ${ESPERAS_MS.length} tentativas.`);
        await marcarStoryFalhou(t).catch(() => { /* status apagado no meio do caminho */ });
        t.aoTerminar?.(null);
    }
}

async function marcarStoryFalhou(t: Pick<Tarefa, "dbSessionId" | "msg">) {
    const s = await prisma.story.findFirst({ where: { sessionId: t.dbSessionId, keyId: t.msg.key.id! }, select: { id: true, mediaUrl: true, extra: true } });
    if (!s || s.mediaUrl) return;
    const atual = (s.extra as any)?.midiaPendente || descritorMidia(t.msg as WAMessage);
    await prisma.story.update({ where: { id: s.id }, data: { extra: { midiaPendente: { ...atual, falhou: true } } as any } });
}

function emitir(sessionId: string, m: any) {
    (global as any).io?.to(sessionId).emit("message.update", [{
        ...m,
        extra: extraParaTela(m.extra),
        sessionKey: sessionId,
        live: false,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    }]);
}

/** "tentar de novo" pela tela: refaz a fila a partir do descritor guardado na mensagem */
export async function tentarMidiaDeNovo(sessionId: string, dbSessionId: string, keyId: string): Promise<boolean> {
    const m = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: dbSessionId, keyId } }, select: { extra: true, mediaUrl: true } });
    if (!m) return false;
    // ja esta baixando (outra aba ou outro atendente clicou): nao agenda de novo
    if ((m.extra as any)?.midiaPendente && !(m.extra as any).midiaPendente.falhou) return true;
    let desc = (m.extra as any)?.midiaPendente;
    if (m.mediaUrl) {
        // ja tem arquivo registrado: so baixa de novo se ele sumiu do disco (e se ha os dados de download)
        const { localizarMidia, nomeDoMediaUrl } = await import("./pasta-midia");
        const nome = nomeDoMediaUrl(m.mediaUrl);
        if (nome && (await localizarMidia(nome))) return true;
        desc = (m.extra as any)?.midiaOrigem;
    }
    const msg = mensagemDoDescritor(desc);
    if (!msg) return false;
    const extra: any = { ...(m.extra as any) };
    extra.midiaPendente = { key: desc.key, m: desc.m, falhou: false };
    // o mediaUrl fica como esta: se o arquivo so parecia ausente (disco montando, pasta antiga), o ponteiro nao se perde;
    // quando o download termina, processar() grava o mediaUrl de novo
    await prisma.message.update({ where: { sessionId_keyId: { sessionId: dbSessionId, keyId } }, data: { extra } });
    estado.naFila.delete(`${sessionId}:${keyId}`);
    agendarDownload({ sessionId, dbSessionId, msg });
    return true;
}

/**
 * minha versao: a fila fica na memoria. Se o servidor reinicia (atualizacao, queda) com midias ainda baixando,
 * elas ficavam marcadas como "baixando" para sempre (a imagem so rodava, sem o botao "tentar de novo").
 * Ao conectar a sessao, devolve essas midias para a fila; a propria fila marca "falhou" se nao der.
 */
const RETOMAR_DIAS = 7;
const RETOMAR_MAX = 500;
const RETOMAR_VEZES = 3;

export async function retomarMidiasPendentes(sessionId: string): Promise<number> {
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!sessao) return 0;
    const desde = new Date(Date.now() - RETOMAR_DIAS * 24 * 60 * 60 * 1000);
    const candidatas = await prisma.message.findMany({
        where: { sessionId: sessao.id, mediaUrl: null, type: { in: TIPOS_MIDIA as any }, timestamp: { gte: desde } },
        select: { keyId: true, extra: true },
        orderBy: { timestamp: "desc" },
        take: RETOMAR_MAX,
    });
    let n = 0;
    for (const c of candidatas) {
        const pend = (c.extra as any)?.midiaPendente;
        if (!pend || pend.falhou) continue;
        // revisao de seguranca: conta as retomadas no banco; se uma midia derrubar o processo,
        // ela nao volta para sempre a cada reinicio (desiste e fica o botao "tentar de novo")
        const retomadas = (Number(pend.retomadas) || 0) + 1;
        const desistir = retomadas > RETOMAR_VEZES;
        const extra = { ...(c.extra as any), midiaPendente: { ...pend, retomadas, falhou: desistir } };
        await prisma.message.update({ where: { sessionId_keyId: { sessionId: sessao.id, keyId: c.keyId } }, data: { extra } });
        if (desistir) continue;
        const msg = mensagemDoDescritor(pend);
        if (!msg) continue;
        agendarDownload({ sessionId, dbSessionId: sessao.id, msg });
        n++;
    }
    if (n) logger.info("Media", `${n} midia(s) que estavam baixando antes de reiniciar voltaram para a fila.`);
    return n;
}
