import cron from "node-cron";
import cronParser from "cron-parser";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { logger } from "./logger";
import { executarRetencao, diaJaExecutado, marcarDiaExecutado } from "./retencao";
import { horaNoFuso, diaNoFuso } from "./lgpd-puro";

// minha versao: fuso das configuracoes do sistema (antes o cron usava Asia/Jakarta fixo)
async function fusoDoSistema(): Promise<string> {
    try {
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" }, select: { timezone: true } });
        return cfg?.timezone || process.env.TZ || "America/Sao_Paulo";
    } catch { return process.env.TZ || "America/Sao_Paulo"; }
}
export function initScheduler() {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();
            
            // Fetch pending messages due for sending
            const pendingMessages = await prisma.scheduledMessage.findMany({
                where: {
                    status: "PENDING",
                    sendAt: {
                        lte: now
                    }
                },
                include: {
                    session: true
                }
            });

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            for (const msg of pendingMessages) {
                const instance = waManager.getInstance(msg.session.sessionId);

                if (!instance || !instance.socket) {
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    // Optionally mark as FAILED or retry later
                    // keeping PENDING will define behavior (retry next minute)
                    // But if session is dead for long time, it piles up.
                    // Let's keep it PENDING for now.
                    continue;
                }

                // minha versao: confere a expressao ANTES de enviar. Uma expressao invalida deixava a linha para sempre
                // pendente, reenviando a cada minuto e derrubando o restante do lote; agora a linha vira FAILED.
                let proximaData: Date | null = null;
                if (msg.cronExpression) {
                    try {
                        proximaData = cronParser.parse(msg.cronExpression, { tz: await fusoDoSistema() }).next().toDate();
                    } catch (e) {
                        logger.error("Cron", `Expressao invalida em ${msg.id}; agendamento marcado como FAILED.`, e);
                        await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "FAILED" } }).catch(() => {});
                        continue;
                    }
                }

                try {
                    logger.info("Cron", `Sending to ${msg.jid}`);
                    
                    if (msg.mediaUrl) {
                        const type = msg.mediaType || "document";
                        let payload: any = {};
                        if (msg.content) payload.caption = msg.content;

                        // minha versao (C1): NAO entregar a URL crua ao Baileys. Sem isto, uma URL "file:" ou um
                        // caminho local faz o Baileys LER UM ARQUIVO DO SERVIDOR (ex.: .env) e mandar no WhatsApp,
                        // e uma URL http interna vira SSRF. safeFetchBuffer bloqueia IP privado/metadados e so https.
                        const { safeFetchBuffer } = await import("@/lib/security");
                        const { buffer, contentType, fileName } = await safeFetchBuffer(msg.mediaUrl, {
                            maxBytes: 50 * 1024 * 1024,
                            timeoutMs: 15000,
                        });

                        if (type === "image") {
                            payload.image = buffer;
                            payload.mimetype = contentType || "image/jpeg";
                        } else if (type === "video") {
                            payload.video = buffer;
                            payload.mimetype = contentType || "video/mp4";
                        } else if (type === "audio") {
                            payload = { audio: buffer, mimetype: contentType || "audio/mp4" };
                        } else {
                            payload.document = buffer;
                            payload.mimetype = contentType || "application/octet-stream";
                            payload.fileName = fileName || msg.mediaUrl.split('/').pop() || "file";
                        }
                        await instance.socket.sendMessage(msg.jid, payload);
                    } else {
                        await instance.socket.sendMessage(msg.jid, { text: msg.content || "" });
                    }

                    // Update status or compute next sendAt if recurring
                    if (proximaData) {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: proximaData } // Keep status as PENDING
                        });
                    } else {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "SENT" }
                        });
                    }

                } catch (error) {
                    logger.error("Cron", `Check failed for ${msg.id}`, error);
                    if (!msg.cronExpression) {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "FAILED" } // Failed to send
                        });
                    } else if (proximaData) {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: proximaData }
                        });
                    }
                }
            }

        } catch (error) {
            logger.error("Cron", "Scheduler error:", error);
        }
    });
    
    // minha versao: LGPD — retencao diaria as 03:00 no fuso do sistema. Roda de hora em hora (minuto 0) e confere a hora
    // NO FUSO do sistema, que e lido do banco (muda sem reiniciar). Uma vez por dia por processo.
    cron.schedule("0 * * * *", async () => {
        try {
            const fuso = await fusoDoSistema();
            if (horaNoFuso(fuso) !== 3) return;
            const dia = diaNoFuso(fuso);
            if (diaJaExecutado(dia)) return;
            marcarDiaExecutado(dia);
            const r = await executarRetencao("AGENDADA");
            logger.info("Cron", `Retencao: ${r.mensagens?.apagadas ?? 0} mensagem(ns), ${r.midias?.arquivos ?? 0} midia(s)${r.erro ? ` (erro: ${r.erro})` : ""}`);
        } catch (error) {
            logger.error("Cron", "Retention error:", error);
        }
    });

    logger.info("Cron", "Scheduler initialized");
}
