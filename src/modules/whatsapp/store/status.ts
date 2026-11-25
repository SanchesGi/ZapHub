// minha versao: status (stories) recebidos e publicados. Antes, as mensagens de status@broadcast eram gravadas como
// mensagens comuns (sem o autor, que vem em key.participant) e so escondidas das listas. Agora ficam na tabela Story:
// com autor, horario, legenda e midia, validos por 24 h, e NAO viram conversa nem notificacao de mensagem.
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import type { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isLidJid, normalizeJid, resolveToPhoneJid } from "@/lib/jid-utils";
import { onMessageReceived, onMessageSent } from "@/lib/webhook";
import { agendarDownload, descritorMidia } from "@/lib/midia-fila";
import { apagarArquivosDeMidia } from "@/lib/lgpd-midia";
import { VALIDADE_STATUS_MS, expiraEmDe, lerConteudoDeStatus, statusVigente } from "@/lib/status-puro";
import { mascararNumero } from "@/lib/mascarar-numero";

const LOTE_LIMPEZA = 200;
const MAX_LOTES_LIMPEZA = 10;

/** tira o sufixo de aparelho ("5511...:12@s.whatsapp.net" -> "5511...@s.whatsapp.net") */
function semAparelho(jid: string | null | undefined): string {
    return normalizeJid(jid).replace(/:\d+(?=@)/, "");
}

function instanteDaMensagem(msg: WAMessage): Date {
    const agora = Date.now();
    const bruto = msg.messageTimestamp;
    const seg = typeof bruto === "number" ? bruto : Number(bruto);
    const t = Number.isFinite(seg) && seg > 0 ? seg * 1000 : agora;
    return new Date(Math.min(t, agora)); // horario do futuro (relogio errado) nao estica a validade
}

/** avisa as telas abertas da sessao; elas recarregam a lista (cada usuario tem os seus "vistos") */
function avisarTelas(io: Server | null | undefined, sessionId: string, acao: "novo" | "midia" | "apagado", id: string, fromMe: boolean, live: boolean) {
    const sala = io ?? ((globalThis as any).io as Server | undefined);
    sala?.to(sessionId).emit("status.update", { sessionKey: sessionId, acao, id, fromMe, live });
}

// minha versao: diagnostico do status ("os status nao aparecem"): cada status que chega, o que foi gravado e o MOTIVO
// de cada descarte vao para o log, sem dados pessoais (autor so com os 4 ultimos digitos, nada de texto nem legenda).
const TAG_LOG = "Status";

function autorParaLog(msg: WAMessage): string {
    if (msg.key.fromMe) return "eu";
    const bruto = msg.key.participant || (msg as any).participant;
    return bruto ? `${mascararNumero(bruto)}${isLidJid(bruto) ? " (lid)" : ""}` : "sem autor";
}

/** o tipo "de verdade" da mensagem (ex.: audioMessage), para dizer por que nao guardamos */
function tipoBrutoDoStatus(conteudo: any): string {
    if (!conteudo || typeof conteudo !== "object") return "vazio";
    return Object.keys(conteudo).find((k) => k !== "messageContextInfo") || "vazio";
}

/** registra o descarte com o motivo e devolve null (o chamador so faz `return descartarStatus(...)`) */
function descartarStatus(sessionId: string, keyId: string | null | undefined, motivo: string): null {
    logger.debug(TAG_LOG, `descartado: ${motivo} (sessao=${sessionId} id=${keyId || "?"})`);
    return null;
}

type ParamsRegistro = {
    msg: WAMessage;
    dbSessionId: string;
    sessionId: string;
    sock?: WASocket;
    io?: Server | null;
    aoVivo: boolean; // chegou agora (notify/append), nao e sincronizacao de historico
    triggerWebhook?: boolean;
};

/** quem publicou: o proprio numero ou o contato (em telefone, mesmo quando o WhatsApp manda @lid) */
async function autorDoStatus(msg: WAMessage, dbSessionId: string, sock?: WASocket): Promise<string | null> {
    if (msg.key.fromMe) return semAparelho(sock?.user?.id) || "eu";
    const bruto = msg.key.participant || (msg as any).participant;
    if (!bruto) return null; // sem autor nao ha como atribuir
    const alt = (msg.key as any).participantAlt || null;
    const jid = isLidJid(bruto) ? await resolveToPhoneJid(bruto, dbSessionId, alt) : bruto;
    return semAparelho(jid);
}

/**
 * Trata uma mensagem de status@broadcast. Devolve o id do status gravado, ou null quando nada foi gravado
 * (ja existia, vencido, tipo que nao guardamos, apagado pelo autor).
 */
// minha versao: o mesmo status chega por dois caminhos ao mesmo tempo (publicado pelo painel e devolvido pelo
// evento do Baileys). Sem unique no banco, esta trava por status impede gravar duas vezes (um so processo).
const emAndamento = new Set<string>();

export async function tratarStatus(p: ParamsRegistro): Promise<string | null> {
    const trava = `${p.dbSessionId}|${p.msg.key.id || ""}`;
    if (emAndamento.has(trava)) return descartarStatus(p.sessionId, p.msg.key.id, "ja esta sendo tratado (chegou por dois caminhos)");
    emAndamento.add(trava);
    try {
        return await tratarStatusSemTrava(p);
    } finally {
        emAndamento.delete(trava);
    }
}

async function tratarStatusSemTrava(p: ParamsRegistro): Promise<string | null> {
    const { msg, dbSessionId, sessionId, sock, io } = p;
    const keyId = msg.key.id;
    if (!keyId || !msg.message) return descartarStatus(sessionId, keyId, "sem conteudo (mensagem sem id ou sem corpo)");

    // o autor apagou o status
    const protocolo: any = (msg.message as any).protocolMessage;
    if (protocolo) {
        logger.info(TAG_LOG, `pedido do autor para apagar um status (sessao=${sessionId} autor=${autorParaLog(msg)})`);
        if (protocolo.type === 0 && protocolo.key?.id) await apagarStatusDoAutor(p, protocolo.key.id);
        return null;
    }

    const normalizado = normalizeMessageContent(msg.message);
    const conteudo = lerConteudoDeStatus(normalizado);
    const tipoBruto = tipoBrutoDoStatus(normalizado);
    logger.debug(TAG_LOG, `chegou (sessao=${sessionId} id=${keyId} tipo=${conteudo?.tipo || tipoBruto} autor=${autorParaLog(msg)} aoVivo=${p.aoVivo})`);
    if (!conteudo) {
        const soTexto = tipoBruto === "conversation" || tipoBruto === "extendedTextMessage";
        return descartarStatus(sessionId, keyId, soTexto ? "sem conteudo (texto vazio)" : `tipo nao suportado (${tipoBruto})`);
    }

    const criadoEm = instanteDaMensagem(msg);
    if (!statusVigente({ criadoEm })) { // o historico traz status de ontem: ja venceram
        return descartarStatus(sessionId, keyId, `vencido (tem ${Math.round((Date.now() - criadoEm.getTime()) / 3_600_000)} h; vale ${Math.round(VALIDADE_STATUS_MS / 3_600_000)} h)`);
    }

    const ja = await prisma.story.findFirst({ where: { sessionId: dbSessionId, keyId }, select: { id: true } });
    if (ja) return descartarStatus(sessionId, keyId, "ja existia no banco");

    const autor = await autorDoStatus(msg, dbSessionId, sock);
    if (!autor) return descartarStatus(sessionId, keyId, "sem autor (nao veio o participante)");

    // minha versao: midia NUNCA e esperada aqui (nao trava o messages.upsert nem faz rajada com o historico): o status
    // grava com a midia pendente e a fila de lib/midia-fila.ts baixa, com limite de simultaneos e prioridade baixa
    let extra: Record<string, unknown> | undefined;
    if (conteudo.tipo !== "TEXT") extra = { midiaPendente: descritorMidia(msg) };

    let story;
    try {
        story = await prisma.story.create({
            data: {
                sessionId: dbSessionId,
                jid: autor,
                keyId,
                type: conteudo.tipo,
                content: conteudo.texto || null,
                mediaUrl: null,
                timestamp: criadoEm,
                expiraEm: expiraEmDe(criadoEm),
                autorNome: msg.key.fromMe ? null : (msg.pushName || null),
                fromMe: !!msg.key.fromMe,
                fundo: conteudo.fundo,
                fonte: conteudo.fonte,
                ...(extra ? { extra: extra as any } : {}),
            },
            select: { id: true },
        });
    } catch (e: any) {
        if (e?.code === "P2002") return descartarStatus(sessionId, keyId, "ja existia no banco (gravado por outro caminho)"); // chegou por dois caminhos ao mesmo tempo: ja esta salvo
        throw e;
    }
    logger.info(TAG_LOG, `gravado (sessao=${sessionId} id=${keyId} tipo=${conteudo.tipo} autor=${autorParaLog(msg)} registro=${story.id})`);

    avisarTelas(io, sessionId, "novo", story.id, !!msg.key.fromMe, p.aoVivo);

    // quem usa webhook continua recebendo o evento do status, como antes (com o chatType STATUS).
    // Com midia, o evento sai quando a fila termina o download (o webhook receberia o arquivo ja pronto)
    const enviarWebhook = (url: string | null) => {
        if (!p.triggerWebhook) return;
        const envio = msg.key.fromMe ? onMessageSent(sessionId, msg, url) : onMessageReceived(sessionId, msg, url);
        envio.catch((e) => logger.error("Webhook", "Erro no webhook do status", e));
    };
    if (conteudo.tipo === "TEXT") enviarWebhook(null);
    else agendarDownload({ sessionId, dbSessionId, msg, alvo: "story", prioridade: false, aoTerminar: enviarWebhook });
    return story.id;
}

// ---- apagar ----

/** remove os status e os arquivos que nenhuma mensagem usa */
async function apagarStories(rows: { id: string; mediaUrl: string | null }[]) {
    if (!rows.length) return;
    const urls = rows.map((r) => r.mediaUrl).filter((u): u is string => !!u);
    if (urls.length) {
        const emUso = new Set((await prisma.message.findMany({ where: { mediaUrl: { in: urls } }, select: { mediaUrl: true } })).map((m) => m.mediaUrl));
        await apagarArquivosDeMidia(urls.filter((u) => !emUso.has(u)));
    }
    await prisma.story.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

/** o autor apagou o status no WhatsApp: so vale se quem pediu e o mesmo autor */
async function apagarStatusDoAutor(p: ParamsRegistro, alvoKeyId: string) {
    const story = await prisma.story.findFirst({
        where: { sessionId: p.dbSessionId, keyId: alvoKeyId },
        select: { id: true, jid: true, fromMe: true, mediaUrl: true },
    });
    if (!story) return;
    const quem = await autorDoStatus(p.msg, p.dbSessionId, p.sock);
    if (!quem || (story.fromMe !== !!p.msg.key.fromMe) || (!story.fromMe && story.jid !== quem)) {
        logger.warn("Status", `Pedido de apagar o status ${alvoKeyId} ignorado: quem pediu nao e o autor.`);
        return;
    }
    await apagarStories([story]);
    avisarTelas(p.io, p.sessionId, "apagado", story.id, story.fromMe, true);
}

let limpando = false;

/** apaga os status vencidos (e os arquivos deles). Sem `dbSessionId`, limpa todas as sessoes. */
export async function limparStatusVencidos(dbSessionId?: string): Promise<number> {
    if (limpando) return 0;
    limpando = true;
    try {
        const agora = Date.now();
        let apagados = 0;
        for (let i = 0; i < MAX_LOTES_LIMPEZA; i++) {
            const rows = await prisma.story.findMany({
                where: {
                    ...(dbSessionId ? { sessionId: dbSessionId } : {}),
                    OR: [{ expiraEm: { lt: new Date(agora) } }, { expiraEm: null, timestamp: { lt: new Date(agora - VALIDADE_STATUS_MS) } }],
                },
                select: { id: true, mediaUrl: true },
                take: LOTE_LIMPEZA,
            });
            if (!rows.length) break;
            await apagarStories(rows);
            apagados += rows.length;
            if (rows.length < LOTE_LIMPEZA) break;
        }
        return apagados;
    } finally {
        limpando = false;
    }
}
