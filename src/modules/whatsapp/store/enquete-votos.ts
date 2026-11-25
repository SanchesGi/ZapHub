// minha versao: placar ao vivo das enquetes.
// No Baileys 7.0.0-rc14 o voto chega como `pollUpdateMessage` CIFRADO e a decifragem embutida esta comentada
// (Utils/process-message.js). Aqui: (1) guarda a chave da enquete ao grava-la, (2) decifra cada voto com
// decryptPollVote, (3) grava o placar em Message.extra.enquete.votos e avisa a tela por `message.update`.
// So o necessario fica guardado: a chave (messageSecret) e os JIDs de quem criou, em extra.enqueteSegredo,
// que NUNCA vai para o navegador (ver extraParaTela em lib/midia-fila.ts).
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { decryptPollVote, normalizeMessageContent } from "@whiskeysockets/baileys";
import type { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isLidJid, normalizeJid, resolveToPhoneJid } from "@/lib/jid-utils";
import { emSerie } from "@/lib/fila-por-chave";
import { aplicarVoto, lerEnquete, type Enquete } from "@/lib/enquete";
import { decifrarComCandidatos, jidSemAparelho, jidsCandidatos, numeroDe, opcoesDoVoto } from "@/lib/enquete-servidor";
import { extraParaTela } from "@/lib/midia-fila";
import { mesmoChat } from "./autoria-protocolo";

const SEM_VOTOS = { votos: {} as Record<string, string[]>, vezes: {} as Record<string, number> };

type Segredo = { segredo: string; criador: string[]; vezes?: Record<string, number> };

/** a enquete lida da mensagem do WhatsApp (criacao), ou null se a mensagem nao for uma enquete */
export function enqueteDaMensagem(conteudo: any): { nome: string; opcoes: string[]; multipla: boolean } | null {
    const mc = conteudo || {};
    const poll = mc.pollCreationMessage || mc.pollCreationMessageV2 || mc.pollCreationMessageV3 || mc.pollCreationMessageV5;
    if (!poll) return null;
    const opcoes = (poll.options || []).map((o: any) => o?.optionName).filter((o: unknown): o is string => typeof o === "string" && !!o);
    if (!opcoes.length) return null;
    // 1 = escolha unica; 0 ou mais de 1 = varias respostas
    return { nome: String(poll.name || ""), opcoes, multipla: Number(poll.selectableOptionsCount) !== 1 };
}

/**
 * O que gravar em Message.extra ao salvar uma enquete: a estrutura que a tela mostra (`enquete`) e a chave para
 * decifrar os votos (`enqueteSegredo`, so no servidor). Sem a chave (mensagem antiga/sem contexto), so a estrutura.
 */
export function extraDaEnquete(msg: WAMessage, conteudo: any, sock?: WASocket): Record<string, unknown> | null {
    const e = enqueteDaMensagem(conteudo);
    if (!e) return null;
    const saida: Record<string, unknown> = { enquete: { nome: e.nome, opcoes: e.opcoes, multipla: e.multipla } };
    const raw: any = msg.message || {};
    const segredo = raw.messageContextInfo?.messageSecret || conteudo?.messageContextInfo?.messageSecret;
    if (segredo && (segredo as Uint8Array).length) {
        const eu = [sock?.user?.id, (sock?.user as any)?.lid];
        const grupo = !!msg.key.remoteJid?.endsWith("@g.us");
        const criador = msg.key.fromMe
            ? jidsCandidatos(...eu)
            : jidsCandidatos(msg.key.participant, (msg.key as any).participantAlt, grupo ? null : msg.key.remoteJid, (msg.key as any).remoteJidAlt);
        saida.enqueteSegredo = { segredo: Buffer.from(segredo as Uint8Array).toString("base64"), criador } satisfies Segredo;
    }
    return saida;
}

/** telefone de quem votou (cai no @lid so se nao houver como descobrir) */
async function jidDoVotante(msg: WAMessage, dbSessionId: string, sock?: WASocket): Promise<string> {
    const key: any = msg.key;
    if (key.fromMe) return normalizeJid(jidSemAparelho(sock?.user?.id || ""));
    const grupo = !!key.remoteJid?.endsWith("@g.us");
    const bruto: string = (grupo ? key.participant || (msg as any).participant : key.remoteJid) || "";
    const alt: string | null = (grupo ? key.participantAlt : key.remoteJidAlt) || null;
    const semAparelho = normalizeJid(jidSemAparelho(bruto));
    if (!isLidJid(semAparelho)) return semAparelho;
    if (alt && !isLidJid(alt)) return normalizeJid(jidSemAparelho(alt));
    return normalizeJid(jidSemAparelho(await resolveToPhoneJid(semAparelho, dbSessionId, alt)));
}

/** trata um `pollUpdateMessage` (voto) recebido: decifra, atualiza o placar e avisa a tela. Nunca lanca. */
export async function tratarVotoEnquete(p: {
    msg: WAMessage; dbSessionId: string; sessionId: string; sock?: WASocket; io?: Server | null;
}): Promise<void> {
    try {
        const conteudo: any = normalizeMessageContent(p.msg.message) || p.msg.message || {};
        const upd = conteudo.pollUpdateMessage;
        const chaveEnquete = upd?.pollCreationMessageKey;
        const voto = upd?.vote;
        if (!chaveEnquete?.id || !voto?.encPayload || !voto?.encIv) return;
        const { dbSessionId, sessionId } = p;

        const alvo = await prisma.message.findUnique({
            where: { sessionId_keyId: { sessionId: dbSessionId, keyId: chaveEnquete.id } },
            select: { remoteJid: true, extra: true },
        });
        const remoteJid = p.msg.key.remoteJid || "";
        // o voto so vale na mesma conversa da enquete
        const chatDoVoto = [remoteJid, (p.msg.key as any).remoteJidAlt, await resolveToPhoneJid(remoteJid, dbSessionId, (p.msg.key as any).remoteJidAlt)];
        if (!alvo || !mesmoChat(alvo.remoteJid, chatDoVoto)) {
            logger.debug("Store", `Voto de enquete ${chaveEnquete.id} ignorado: enquete desconhecida ou de outra conversa.`);
            return;
        }
        const segredo = (alvo.extra as any)?.enqueteSegredo as Segredo | undefined;
        const enquete = lerEnquete(alvo.extra);
        if (!segredo?.segredo || !enquete) {
            logger.debug("Store", `Voto de enquete ${chaveEnquete.id} ignorado: enquete sem chave guardada (anterior ao placar).`);
            return;
        }

        // quem votou, nas formas que o WhatsApp pode ter usado na chave (telefone ou @lid; eu = meus dois ids)
        const key: any = p.msg.key;
        const grupo = remoteJid.endsWith("@g.us");
        const eu = [p.sock?.user?.id, (p.sock?.user as any)?.lid];
        const votantes = key.fromMe
            ? jidsCandidatos(...eu)
            : jidsCandidatos(grupo ? key.participant : remoteJid, grupo ? key.participantAlt : key.remoteJidAlt, key.participantAlt, key.remoteJidAlt, (p.msg as any).participant);
        const pollEncKey = Buffer.from(segredo.segredo, "base64");
        const achado = decifrarComCandidatos(segredo.criador || [], votantes, (criador, votante) =>
            decryptPollVote(voto, { pollCreatorJid: criador, pollMsgId: chaveEnquete.id, pollEncKey, voterJid: votante }));
        if (!achado) {
            logger.warn("Store", `Nao consegui decifrar o voto da enquete ${chaveEnquete.id} (JIDs de criador/votante nao bateram).`);
            return;
        }
        const escolhidas = opcoesDoVoto(achado.resultado.selectedOptions || [], enquete.opcoes);
        const votante = await jidDoVotante(p.msg, dbSessionId, p.sock);
        const quando = numeroDe(upd.senderTimestampMs, Date.now());

        await gravarVoto({ dbSessionId, sessionId, keyId: chaveEnquete.id, votante, escolhidas, quando, io: p.io });
    } catch (e) {
        logger.error("Store", "Erro ao tratar voto de enquete", e);
    }
}

async function gravarVoto(p: {
    dbSessionId: string; sessionId: string; keyId: string; votante: string; escolhidas: string[]; quando: number; io?: Server | null;
}): Promise<void> {
    await emSerie(`enquete:${p.dbSessionId}:${p.keyId}`, async () => {
        // le de novo dentro da fila: outro voto pode ter gravado enquanto este era decifrado
        const m = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: p.dbSessionId, keyId: p.keyId } } });
        const extra: any = m?.extra;
        const enquete: Enquete | null = lerEnquete(extra);
        const segredo = extra?.enqueteSegredo as Segredo | undefined;
        if (!m || !enquete || !segredo) return;

        const r = aplicarVoto(
            { votos: enquete.votos || SEM_VOTOS.votos, vezes: segredo.vezes || SEM_VOTOS.vezes },
            enquete.opcoes, p.votante, p.escolhidas, p.quando
        );
        if (!r.mudou && segredo.vezes?.[p.votante] === r.vezes[p.votante]) return;

        const novoExtra = {
            ...extra,
            enquete: { nome: enquete.nome, opcoes: enquete.opcoes, multipla: enquete.multipla, votos: r.votos },
            enqueteSegredo: { ...segredo, vezes: r.vezes },
        };
        const atualizada = await prisma.message.update({ where: { id: m.id }, data: { extra: novoExtra as any } });
        p.io?.to(p.sessionId).emit("message.update", [{
            ...atualizada,
            extra: extraParaTela(atualizada.extra),
            sessionKey: p.sessionId,
            live: false,
            timestamp: atualizada.timestamp instanceof Date ? atualizada.timestamp.toISOString() : atualizada.timestamp,
        }]);
    });
}
