import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage, Contact } from "@whiskeysockets/baileys";
import { normalizeMessageContent, areJidsSameUser } from "@whiskeysockets/baileys";
import { onMessageReceived, onMessageSent, dispatchWebhook, downloadAndSaveMedia } from "@/lib/webhook";
import { handleBotCommand, setSessionStartTime } from "../bot/command-handler";
import { resolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";
import { nomeAgentePendente, enviadaPelaPlataforma } from "@/lib/agente";
import { comRetry1020 } from "./groups";
import { registrarApagada, apagandoPeloPainel } from "@/lib/auditoria";
import { agendarDownload, descritorMidia, extraParaTela, TIPOS_MIDIA } from "@/lib/midia-fila";
import { registrarFixacao, estadosDe } from "./estado-chat";
import { lidaAte, avisarSeFicouLida } from "@/lib/leitura";
import { previaDoWhatsApp } from "@/lib/previa-link";
import { autorDoProtocolo, ehAdmin, mesmoChat, type Pedido } from "./autoria-protocolo";

import { Server } from "socket.io";
import { logger } from "@/lib/logger";

// minha versao: le o vCard de um contato encaminhado -> { nome, numeros: [{ waid, texto }], empresa? }
// "waid" = numero que tem WhatsApp (o WhatsApp coloca em TEL;...;waid=5546999998888:+55 46 99999-8888)
function lerVcard(vcard?: string | null, displayName?: string | null) {
    const v = String(vcard || "").replace(/\r?\n[ \t]/g, ""); // desdobra linhas continuadas
    const campo = (re: RegExp) => (re.exec(v)?.[1] || "").trim();
    const nome = campo(/^FN[^:\n]*:(.*)$/m) || displayName || "";
    const empresa = campo(/^ORG[^:\n]*:(.*)$/m).replace(/;+$/, "") || null;
    const numeros: { waid: string | null; texto: string }[] = [];
    for (const linha of v.split(/\r?\n/)) {
        if (!/^(item\d+\.)?TEL/i.test(linha)) continue;
        const waid = /waid=(\d+)/i.exec(linha)?.[1] || null;
        const texto = linha.slice(linha.indexOf(":") + 1).trim();
        if (waid || texto) numeros.push({ waid, texto });
    }
    return { nome, empresa, numeros };
}

// minha versao: mensagem apagada PELO WHATSAPP (o contato que mandou, um admin do grupo, ou este numero pelo celular)
// -> registro na Auditoria (quem apagou, quem escreveu, conteudo) e a mensagem vira "🚫 Esta mensagem foi apagada".
// Chamada pelos dois caminhos por onde o WhatsApp avisa (protocolMessage REVOKE no upsert e o stub REVOKE no
// messages.update); nao duplica. Se a mensagem nao estava salva (chegou e foi apagada com o servidor fora), registra
// assim mesmo, sem o conteudo.
// minha versao: monta as formas conhecidas (telefone e lid) do chat e de quem enviou o pedido de editar/apagar
async function montarPedido(dbSessionId: string, p: { chatJid: string; chatAlt?: string | null; quemJid?: string | null; quemAlt?: string | null; fromMe: boolean }): Promise<Pedido> {
    const chat = [p.chatJid, p.chatAlt, p.chatJid ? await resolveToPhoneJid(p.chatJid, dbSessionId, p.chatAlt) : null];
    const remetente = [p.quemJid, p.quemAlt, p.quemJid ? await resolveToPhoneJid(p.quemJid, dbSessionId, p.quemAlt) : null];
    let admin = false;
    if (!p.fromMe && p.chatJid.endsWith("@g.us")) {
        const g = await prisma.group.findFirst({ where: { sessionId: dbSessionId, jid: p.chatJid }, select: { participants: true } });
        admin = ehAdmin(g?.participants, remetente);
    }
    return { chat, remetente, fromMe: p.fromMe, ehAdminDoGrupo: admin };
}

const apagadasTratadas: Set<string> = ((globalThis as any).__waApagadasTratadas ??= new Set<string>());
export async function tratarApagadaWhatsApp(p: {
    io?: Server | null; sessionId: string; dbSessionId: string;
    alvo: { id: string; remoteJid: string; fromMe: boolean | null; participant: string | null };
    quemFromMe: boolean; quemJid: string | null; quemPushName: string | null;
    chatAlt?: string | null; quemAlt?: string | null; // minha versao: forma em telefone do chat/de quem apagou (quando vem lid)
}) {
    const chave = `${p.sessionId}:${p.alvo.id}`;
    if (apagadasTratadas.has(chave) || apagandoPeloPainel(p.alvo.id)) return;
    apagadasTratadas.add(chave);
    setTimeout(() => apagadasTratadas.delete(chave), 10 * 60_000);
    try {
        const ja = await prisma.auditoria.findFirst({ where: { sessionId: p.sessionId, keyId: p.alvo.id }, select: { id: true } });
        if (ja) return;
        const orig = await prisma.message.findFirst({ where: { sessionId: p.dbSessionId, keyId: p.alvo.id } });
        if ((orig?.extra as any)?.apagada) return;

        // minha versao: so vale se quem pediu e o autor da mensagem alvo (ou admin do grupo / este numero), no mesmo chat.
        // Sem a mensagem salva nao ha como confirmar o autor: so aceita se o pedido veio deste proprio numero.
        if (orig) {
            const pedido = await montarPedido(p.dbSessionId, { chatJid: p.alvo.remoteJid, chatAlt: p.chatAlt, quemJid: p.quemJid, quemAlt: p.quemAlt, fromMe: p.quemFromMe });
            if (!autorDoProtocolo({ remoteJid: orig.remoteJid, fromMe: orig.fromMe, senderJid: orig.senderJid }, pedido, "apagar")) {
                logger.warn("Store", `Pedido de apagar ${p.alvo.id} ignorado: quem pediu nao e o autor da mensagem nem esta no mesmo chat.`);
                return;
            }
        } else if (!p.quemFromMe) {
            return;
        }

        let quemNome: string;
        if (p.quemFromMe) {
            quemNome = "Este número (pelo celular/WhatsApp)";
        } else {
            const c = p.quemJid ? await prisma.contact.findFirst({
                where: { sessionId: p.dbSessionId, OR: [{ jid: p.quemJid }, { lid: p.quemJid }] },
                select: { name: true, notify: true }
            }) : null;
            quemNome = c?.name || c?.notify || p.quemPushName
                || (p.quemJid?.endsWith("@s.whatsapp.net") ? "+" + p.quemJid.split("@")[0] : null) || "Contato";
        }
        const origem = p.quemFromMe ? "CELULAR" : "CONTATO";

        // sem a mensagem salva: monta o que se sabe pela chave (de quem era, em qual conversa)
        const autorFromMe = orig ? orig.fromMe : !!p.alvo.fromMe;
        const mensagem = orig || {
            keyId: p.alvo.id,
            remoteJid: normalizeJid(p.alvo.remoteJid),
            fromMe: autorFromMe,
            senderJid: autorFromMe ? null : (p.alvo.participant || (p.alvo.remoteJid.endsWith("@g.us") ? p.quemJid : p.alvo.remoteJid)),
            pushName: !autorFromMe && p.alvo.participant === p.quemJid ? p.quemPushName : null,
            content: "(conteúdo não disponível: a mensagem não estava salva no painel quando foi apagada)",
            type: null, mediaUrl: null, timestamp: null, sentBy: null,
        };
        await registrarApagada({ sessionKey: p.sessionId, dbSessionId: p.dbSessionId, mensagem, origem, modo: "TODOS", usuarioNome: quemNome });

        if (orig) {
            const atualizada = await prisma.message.update({
                where: { id: orig.id },
                data: {
                    content: "🚫 Esta mensagem foi apagada",
                    type: "TEXT" as any,
                    mediaUrl: null,
                    extra: { apagada: true, por: quemNome, origem } as any,
                }
            });
            p.io?.to(p.sessionId).emit("message.update", [{
                ...atualizada,
                sessionKey: p.sessionId,
                live: false,
                timestamp: atualizada.timestamp instanceof Date ? atualizada.timestamp.toISOString() : atualizada.timestamp
            }]);
        }
        logger.info("Store", `Mensagem ${p.alvo.id} apagada por ${quemNome} (${origem}) registrada na auditoria.`);
    } catch (e) {
        apagadasTratadas.delete(chave);
        logger.error("Store", "Falha ao registrar mensagem apagada na auditoria", e);
    }
}

// minha versao: nome do chat (contato salvo/notify/grupo) e de quem enviou, p/ a notificacao em tempo real
async function nomesParaNotificacao(dbSessionId: string, msgs: any[]): Promise<Map<string, string>> {
    const jids = new Set<string>();
    msgs.forEach((m) => { if (m.remoteJid) jids.add(m.remoteJid); if (m.senderJid) jids.add(m.senderJid); });
    const lista = [...jids];
    const nome = new Map<string, string>();
    if (!lista.length) return nome;
    const [contatos, grupos] = await Promise.all([
        prisma.contact.findMany({ where: { sessionId: dbSessionId, OR: [{ jid: { in: lista } }, { lid: { in: lista } }] }, select: { jid: true, lid: true, name: true, notify: true } }),
        prisma.group.findMany({ where: { sessionId: dbSessionId, jid: { in: lista } }, select: { jid: true, subject: true } })
    ]);
    // 1o os nomes salvos, depois o notify (nome que a pessoa se deu) onde faltar
    for (const campo of ["name", "notify"] as const) {
        contatos.forEach((c) => {
            const n = c[campo];
            if (!n) return;
            if (!nome.has(c.jid)) nome.set(c.jid, n);
            if (c.lid && !nome.has(c.lid)) nome.set(c.lid, n);
        });
    }
    grupos.forEach((g) => { if (g.subject) nome.set(g.jid, g.subject); });
    return nome;
}

export const bindSessionStore = (sock: WASocket, sessionId: string, io: Server | null) => {
    // Set start time for uptime command
    setSessionStartTime(sessionId);

    // First, get the database Session ID (cuid)
    let dbSessionId: string | null = null;

    // Initialize by fetching the session ID
    (async () => {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (session) {
            dbSessionId = session.id;
            logger.info("Store", `Message store initialized for session ${sessionId} (db: ${dbSessionId})`);
        } else {
            logger.error("Store", `Session ${sessionId} not found for message store`);
        }
    })();

    // Handle Messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Process all message types: notify, append, and history sync
        if (type !== 'notify' && type !== 'append') {
            // For history sync, we still want to save messages
            logger.debug("Store", `Received ${messages.length} messages of type: ${type}`);
        }

        // minha versao: removido o evento 'message.upsert', que mandava a mensagem crua do WhatsApp (com a chave das
        // midias) para o navegador e nao tinha ouvinte. A tela recebe 'message.update', ja preparado (extraParaTela).

        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        const processedMessages = [];

        // Fetch Bot Config for auto-read & welcome message
        const config = await prisma.botConfig.findUnique({
            where: { sessionId: dbSessionId }
        });

        for (const msg of messages) {
            try {
                // Auto Read Logic
                if (type === 'notify' && (config as any)?.autoRead && !msg.key.fromMe) {
                    await sock.readMessages([msg.key]);
                }

                const savedMessage = await processAndSaveMessage(msg, dbSessionId, sessionId, type === 'notify', sock, config, io, type === 'notify' || type === 'append');
                if (savedMessage) {
                    processedMessages.push(savedMessage);
                }

                // Execute Bot Commands (Only for Notify / New Messages)
                if (type === 'notify' && savedMessage) {
                    // Run in background, don't await strictly to not block saving
                    handleBotCommand(sock, sessionId, msg).catch(e => logger.error("Bot", "Bot Handler Error", e));
                }
            } catch (error) {
                logger.error("Store", "Error saving message", error);
            }
        }

        // Emit to socket room for real-time frontend updates
        if (processedMessages.length > 0) {
            // Serialize for frontend: convert Date to ISO string
            // minha versao: "live" = mensagem nova de verdade (nao sincronizacao/historico) + nomes p/ notificacao
            const live = type === 'notify';
            let nomes = new Map<string, string>();
            if (live) { try { nomes = await nomesParaNotificacao(dbSessionId, processedMessages); } catch { /* sem nomes */ } }
            // minha versao: a tela precisa saber se a conversa esta silenciada (nao notifica) ou arquivada (fica no arquivo)
            let estados: Awaited<ReturnType<typeof estadosDe>> = new Map();
            try { estados = await estadosDe(dbSessionId, [...new Set(processedMessages.map((m: any) => m.remoteJid))]); } catch { /* sem estado */ }
            const serialized = processedMessages.map((m: any) => ({
                ...m,
                extra: extraParaTela(m.extra),
                sessionKey: sessionId, // minha versao: o navegador filtra por sessao (nao mistura sessoes)
                live,
                silenciada: estados.get(m.remoteJid)?.silenciada || false,
                arquivada: estados.get(m.remoteJid)?.arquivada || false,
                chatName: nomes.get(m.remoteJid) || null,
                senderName: (m.senderJid && nomes.get(m.senderJid)) || m.pushName || null,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
            }));
            logger.debug("Socket", `Emitting message.update for ${serialized.length} messages in session ${sessionId}`);
            io?.to(sessionId).emit('message.update', serialized);
        }
    });

    // minha versao: o WhatsApp avisa qual telefone esta por tras de um @lid. Sem guardar isso, a mensagem para
    // um numero novo (fora da agenda) caia numa conversa "@lid" sem nome e a conversa aberta pelo telefone
    // ficava vazia. Guarda o vinculo no contato e junta as mensagens que ja tinham ficado no @lid.
    sock.ev.on('lid-mapping.update', async ({ lid, pn }) => {
        try {
            if (!lid || !pn) return;
            if (!dbSessionId) {
                const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                if (!s) return;
                dbSessionId = s.id;
            }
            await vincularLidAoTelefone(dbSessionId, lid, pn);
        } catch (e) {
            logger.error("Store", "Falha ao guardar o vinculo @lid -> telefone", e);
        }
    });

    // Handle Message History Sync (when connecting for the first time or syncing)
    sock.ev.on('messaging-history.set', async ({ messages, chats, contacts, isLatest }) => {
        logger.info("Store", `History sync: ${messages?.length || 0} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, latest: ${isLatest}`);

        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        // Save all historical messages
        if (messages && messages.length > 0) {
            logger.info("Store", `Syncing ${messages.length} historical messages...`);
            for (const msg of messages) {
                try {
                    await processAndSaveMessage(msg, dbSessionId, sessionId, false, sock, undefined, io);
                } catch (error) {
                    logger.error("Store", "Error saving historical message", error);
                }
            }
            logger.success("Store", `Finished syncing ${messages.length} historical messages`);
        }


        // Note: Contacts and Chats are synced by src/modules/whatsapp/store/contacts.ts
        // We only handle messages here to avoid P2002 Unique Constraint Race Conditions.
        logger.debug("Store", `Finished syncing messages`);
    });

    // Handle Contacts Upsert
    sock.ev.on('contacts.upsert', async (contacts) => {
        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        for (const c of contacts) {
            try {
                if (!c.id) continue;
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: c.id } },
                    create: {
                        sessionId: dbSessionId,
                        jid: c.id,
                        // @ts-ignore
                        lid: c.lid || undefined,
                        name: c.name || c.notify || c.verifiedName,
                        notify: c.notify,
                        // @ts-ignore
                        verifiedName: c.verifiedName,
                        profilePic: c.imgUrl || undefined,
                        data: c as any
                    },
                    update: {
                        // @ts-ignore
                        lid: c.lid || undefined,
                        name: c.name || undefined,
                        notify: c.notify || undefined,
                        // @ts-ignore
                        verifiedName: c.verifiedName || undefined,
                        profilePic: c.imgUrl || undefined,
                        data: c as any
                    }
                });

                // Dispatch webhook for contact update
                dispatchWebhook(sessionId, "contact.update", { jid: c.id, name: c.name, notify: c.notify });
            } catch (e) {
                logger.error("Store", "Error saving contact", e);
            }
        }
    });

    // Handle Message Status Updates
    sock.ev.on('messages.update', async (updates) => {
        if (!dbSessionId) return;

        for (const update of updates) {
            try {
                const keyId = update.key?.id;
                if (!keyId) continue;

                // minha versao: o mapa original estava deslocado (proto.WebMessageInfo.Status:
                // 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED) -> "entregue" virava "lido".
                // E atualizacao sem status (edicao etc.) rebaixava a mensagem para PENDING.
                // minha versao: o WhatsApp tambem avisa "apagada" como atualizacao (stub REVOKE = 1, message: null)
                const up: any = update.update || {};
                if (up.messageStubType === 1 || (up.message === null && up.messageStubType !== undefined)) {
                    const remoteJid = update.key?.remoteJid || "";
                    const quemKey: any = up.key || {};          // chave da mensagem de "apagar" (quem apagou)
                    const quemFromMe = !!(quemKey.fromMe ?? update.key?.fromMe);
                    await tratarApagadaWhatsApp({
                        io, sessionId, dbSessionId,
                        alvo: { id: keyId, remoteJid, fromMe: null, participant: (update.key as any)?.participant || null },
                        quemFromMe,
                        quemJid: quemFromMe ? null : (remoteJid.endsWith("@g.us") ? (quemKey.participant || (update.key as any)?.participant || null) : remoteJid),
                        quemPushName: null,
                        chatAlt: (update.key as any)?.remoteJidAlt || null,
                        quemAlt: (quemKey.participantAlt || (update.key as any)?.participantAlt) || null,
                    });
                    continue;
                }

                const bruto = update.update?.status;
                if (bruto === undefined || bruto === null) continue;
                const statusMap: Record<number, string> = {
                    0: 'FAILED',
                    1: 'PENDING',
                    2: 'SENT',
                    3: 'DELIVERED',
                    4: 'READ',
                    5: 'READ', // reproduzido (audio/video)
                };
                const status = statusMap[bruto as number];
                if (!status) continue;

                // so avanca (um recibo atrasado de "entregue" nao desfaz o "lido")
                const ordem = ['FAILED', 'PENDING', 'SENT', 'DELIVERED', 'READ'];
                const atual = await prisma.message.findUnique({
                    where: { sessionId_keyId: { sessionId: dbSessionId, keyId } },
                    select: { status: true, remoteJid: true, fromMe: true }
                });
                if (!atual) continue;
                if (status !== 'FAILED' && ordem.indexOf(atual.status) >= ordem.indexOf(status)) continue;

                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, keyId },
                    data: { status: status as any }
                });
                io?.to(sessionId).emit('message.status', { sessionKey: sessionId, keyId, remoteJid: atual.remoteJid, status });
                // minha versao: mensagem RECEBIDA virou "lida" = lida no celular/WhatsApp Web (conversa privada)
                if (status === 'READ' && !atual.fromMe) await avisarSeFicouLida(io, sessionId, dbSessionId, atual.remoteJid);

                // Dispatch webhook for message status update
                dispatchWebhook(sessionId, "message.status", {
                    keyId,
                    remoteJid: update.key?.remoteJid,
                    status
                });
            } catch (e) {
                logger.error("Store", "Error updating message status", e);
            }
        }
    });

    // minha versao: em GRUPO, "lida no celular/WhatsApp Web" chega como recibo (message-receipt.update),
    // nao como messages.update — e nao era tratado: grupo lido fora do painel continuava "nao lido" para sempre.
    // So conta o recibo do PROPRIO numero (os recibos dos outros participantes nao dizem nada sobre nos).
    sock.ev.on('message-receipt.update', async (updates) => {
        if (!dbSessionId) return;
        const eu = [sock.user?.id, (sock.user as any)?.lid].filter(Boolean) as string[];
        const porConversa = new Map<string, string[]>();
        for (const u of updates as any[]) {
            const quem = u?.receipt?.userJid;
            if (!u?.key?.id || !u.key.remoteJid || !u.receipt?.readTimestamp || !quem) continue;
            if (!eu.some((j) => areJidsSameUser(j, quem))) continue;
            const ids = porConversa.get(u.key.remoteJid) || [];
            ids.push(u.key.id);
            porConversa.set(u.key.remoteJid, ids);
        }
        for (const [jid, ids] of porConversa) {
            try {
                const r = await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, remoteJid: jid, keyId: { in: ids }, fromMe: false, status: { not: 'READ' } },
                    data: { status: 'READ' },
                });
                if (r.count > 0) await avisarSeFicouLida(io, sessionId, dbSessionId, jid);
            } catch (e) {
                logger.error("Store", "Erro ao marcar grupo lido (recibo do proprio numero)", e);
            }
        }
    });

    // minha versao: conversa lida em outro aparelho (celular) -> zera o contador de nao lidas do painel
    sock.ev.on('chats.update', async (updates) => {
        if (!dbSessionId) return;
        for (const u of updates as any[]) {
            // 0 = lida no celular; -1 = "marcar como nao lida" no celular
            if (!u?.id || typeof u.unreadCount !== "number" || u.unreadCount > 0) continue;
            const naoLida = u.unreadCount < 0;
            try {
                const jids = new Set<string>([normalizeJid(u.id)]);
                if (u.id.endsWith("@lid")) {
                    const c = await prisma.contact.findFirst({ where: { sessionId: dbSessionId, lid: u.id }, select: { jid: true } });
                    if (c?.jid) jids.add(c.jid);
                }
                for (const jid of jids) {
                    const agora = await lidaAte(dbSessionId, jid); // minha versao: relogio do WhatsApp (ver lib/leitura.ts)
                    await prisma.chatLeitura.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                        update: naoLida ? { naoLida: true } : { lidoEm: agora, naoLida: false },
                        create: { sessionId: dbSessionId, jid, lidoEm: agora, naoLida },
                    });
                    io?.to(sessionId).emit(naoLida ? "chat.naoLida" : "chat.lida", { sessionKey: sessionId, jid });
                }
            } catch (e) {
                logger.error("Store", "Erro ao marcar conversa lida", e);
            }
        }
    });

    // Handle Group Updates
    sock.ev.on('groups.update', async (updates) => {
        if (!dbSessionId) return;

        for (const update of updates) {
            try {
                if (!update.id) continue;
                
                // Keep DB in sync
                const updateData: any = {};
                if (update.subject !== undefined) updateData.subject = update.subject;
                if (update.desc !== undefined) updateData.description = update.desc;
                if (update.restrict !== undefined) updateData.restrict = update.restrict;
                if (update.announce !== undefined) updateData.announce = update.announce;
                if (update.owner !== undefined) updateData.ownerJid = update.owner;
                if (update.linkedParent !== undefined) updateData.linkedParentJid = update.linkedParent;
                if (update.isCommunity !== undefined) updateData.isCommunity = update.isCommunity;

                if (Object.keys(updateData).length > 0) {
                    await comRetry1020(() => prisma.group.updateMany({
                        where: { sessionId: dbSessionId as string, jid: update.id },
                        data: updateData
                    }));
                }
                
                // Trigger webhook
                dispatchWebhook(sessionId, "group.update", {
                    jid: update.id,
                    ...update
                });
            } catch (e) {
                logger.error("Store", "Error in groups.update handling", e);
            }
        }
    });

    // Handle Group Participants Update
    sock.ev.on('group-participants.update', async (update) => {
        if (!dbSessionId || !update.id) return;

        try {
            // update.id is the group JID
            // update.participants is array of JIDs
            // update.action is 'add', 'remove', 'promote', 'demote'
            dispatchWebhook(sessionId, "group.participant", {
                jid: update.id,
                action: update.action,
                participants: update.participants
            });
            
            // To properly resync the group participants in DB, it's safer to re-fetch the entire group metadata
            // But we don't await strictly to not block the socket
            sock.groupMetadata(update.id).then(async (g) => {
                await comRetry1020(() => prisma.group.updateMany({
                    where: { sessionId: dbSessionId as string, jid: update.id as string },
                    data: { participants: g.participants as any }
                }));
            }).catch(e => {
                 logger.debug("Store", "Failed to refresh group participants metadata", e);
            });
        } catch (e) {
            logger.error("Store", "Error in group-participants.update handling", e);
        }
    });
};

async function processAndSaveMessage(
    msg: WAMessage,
    dbSessionId: string,
    sessionId: string,
    triggerWebhook: boolean,
    sock?: WASocket,
    config?: any,
    io?: Server | null,
    aoVivo: boolean = false // minha versao: chegou agora (notify/append), nao e sincronizacao de historico
) {
    const keyId = msg.key.id;
    const remoteJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const pushName = msg.pushName;
    // minha versao: ordem das mensagens. O horario do WhatsApp vem em SEGUNDOS, e o das minhas mensagens sai do
    // relogio desta VM; uma resposta rapida (ou a VM adiantada) ficava ACIMA da mensagem que eu tinha enviado.
    // Ao vivo, o que vale e a ordem de chegada aqui (milissegundos, um relogio so para os dois lados). Historico
    // e mensagem atrasada (mais de 5 min de diferenca) mantem o horario do WhatsApp.
    const agora = new Date();
    const doWhatsApp = msg.messageTimestamp
        ? new Date((typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000)
        : null;
    const timestamp = doWhatsApp && !(aoVivo && Math.abs(agora.getTime() - doWhatsApp.getTime()) < 5 * 60_000)
        ? doWhatsApp
        : agora;

    // Filter out Protocol & Empty Messages
    if (!msg.message) return false;
    if (!keyId || !remoteJid) return false;

    // Ignore specific technical message types
    const messageKeys = Object.keys(msg.message);

    // minha versao: REACAO (emoji) -> guarda na mensagem alvo, em Message.reacoes = { quem: { e, n } }
    // ("eu" = este numero de WhatsApp). Texto vazio = reacao removida. Nao vira mensagem propria.
    if (messageKeys.includes('reactionMessage')) {
        const r: any = (msg.message as any).reactionMessage;
        const alvo: string | undefined = r?.key?.id;
        if (alvo) {
            const quem = fromMe ? "eu" : (remoteJid.endsWith("@g.us") ? (msg.key.participant || (msg as any).participant || "membro") : remoteJid);
            try {
                const m = await prisma.message.findUnique({
                    where: { sessionId_keyId: { sessionId: dbSessionId, keyId: alvo } },
                    select: { id: true, remoteJid: true, reacoes: true }
                });
                // minha versao: a reacao so vale na mesma conversa da mensagem alvo
                const chatDaReacao = [remoteJid, (msg.key as any).remoteJidAlt, await resolveToPhoneJid(remoteJid, dbSessionId, (msg.key as any).remoteJidAlt)];
                if (m && mesmoChat(m.remoteJid, chatDaReacao)) {
                    const atual: Record<string, any> = m.reacoes && typeof m.reacoes === "object" ? { ...(m.reacoes as any) } : {};
                    if (r.text) atual[quem] = { e: r.text, n: fromMe ? null : (pushName || null) };
                    else delete atual[quem];
                    await prisma.message.update({ where: { id: m.id }, data: { reacoes: Object.keys(atual).length ? atual : null as any } });
                    io?.to(sessionId).emit("message.reaction", { sessionKey: sessionId, keyId: alvo, remoteJid: m.remoteJid, reacoes: atual });
                }
            } catch (e) {
                logger.error("Store", "Erro ao gravar reacao", e);
            }
        }
        return null;
    }

    // Check for message edit/revoke protocol messages FIRST
    if (messageKeys.includes('protocolMessage')) {
        const pMessage = msg.message.protocolMessage;
        const targetKeyId = pMessage?.key?.id;

        // Message Edit (Type 14)
        if (pMessage?.type === 14 && targetKeyId) {
            const editContent = pMessage?.editedMessage;
            if (editContent) {
                // Determine new text
                const normalizedEdit = normalizeMessageContent(editContent);
                let newText = "";
                if (normalizedEdit?.conversation) newText = normalizedEdit.conversation;
                else if (normalizedEdit?.extendedTextMessage?.text) newText = normalizedEdit.extendedTextMessage.text;

                // minha versao: so edita se quem pediu e o autor da mensagem alvo, no mesmo chat
                const alvoSalvo = await prisma.message.findUnique({
                    where: { sessionId_keyId: { sessionId: dbSessionId, keyId: targetKeyId } },
                    select: { id: true, remoteJid: true, fromMe: true, senderJid: true },
                });
                const quemJid = remoteJid.endsWith("@g.us") ? (msg.key.participant || (msg as any).participant || null) : remoteJid;
                const pedido = alvoSalvo ? await montarPedido(dbSessionId, {
                    chatJid: remoteJid, chatAlt: (msg.key as any).remoteJidAlt, quemJid, quemAlt: (msg.key as any).participantAlt, fromMe: !!fromMe,
                }) : null;
                if (!alvoSalvo || !pedido || !autorDoProtocolo({ remoteJid: alvoSalvo.remoteJid, fromMe: alvoSalvo.fromMe, senderJid: alvoSalvo.senderJid }, pedido, "editar")) {
                    logger.warn("Store", `Edicao de ${targetKeyId} ignorada: alvo desconhecido, de outro autor ou de outro chat.`);
                    return null;
                }

                // Update DB safely
                await prisma.message.update({
                    where: { id: alvoSalvo.id },
                    data: { content: newText } // Note: we don't update timestamp of original
                });

                // Trigger Webhook
                if (triggerWebhook) {
                    dispatchWebhook(sessionId, "message.edited", {
                        keyId: targetKeyId,
                        newContent: newText,
                        remoteJid,
                        fromMe
                    });
                }
            }
            return null; // Stop processing as new message
        }

        // Message Revoke/Deleted (Type 0)
        // minha versao: no lugar do "🛡️ [Deleted by sender — preserved]" (que deixava o texto na conversa e nao dizia
        // quem apagou), a mensagem SOME da conversa ("🚫 Esta mensagem foi apagada") e o conteudo original vai para
        // a Auditoria, com quem escreveu, quem apagou e por onde. Apagada pelo painel ja foi registrada/removida la.
        if (pMessage?.type === 0 && targetKeyId) {
            const isGrupo = remoteJid.endsWith("@g.us");
            await tratarApagadaWhatsApp({
                io, sessionId, dbSessionId,
                alvo: { id: targetKeyId, remoteJid, fromMe: pMessage?.key?.fromMe ?? null, participant: pMessage?.key?.participant || null },
                quemFromMe: !!fromMe,
                quemJid: fromMe ? null : (isGrupo ? (msg.key.participant || (msg as any).participant) : remoteJid),
                quemPushName: pushName || null,
                chatAlt: (msg.key as any).remoteJidAlt || null,
                quemAlt: (msg.key as any).participantAlt || null,
            });

            // Trigger Webhook
            if (triggerWebhook) {
                dispatchWebhook(sessionId, "message.deleted", {
                    keyId: targetKeyId,
                    remoteJid,
                    fromMe
                });
            }
            return null;
        }
    }

    // minha versao: mensagem FIXADA/desfixada na conversa (antes era ignorada). tipo 1 = fixar, 2 = desfixar.
    // Chega tambem pelo historico, entao as fixacoes antigas aparecem depois de parear.
    if (messageKeys.includes('pinInChatMessage')) {
        const pin: any = (msg.message as any).pinInChatMessage;
        const alvo: string | undefined = pin?.key?.id;
        const tipo = Number(pin?.type);
        if (alvo && (tipo === 1 || tipo === 2)) {
            try {
                const chatJid = isLidJid(remoteJid) ? await resolveToPhoneJid(remoteJid, dbSessionId, msg.key.remoteJidAlt) : remoteJid;
                await registrarFixacao({
                    dbSessionId, sessionId, io, jid: chatJid, keyId: alvo, tipo,
                    duracaoSeg: Number((msg.message as any).messageContextInfo?.messageAddOnDurationInSecs) || null,
                    por: fromMe ? "Você" : (pushName || null),
                    quando: timestamp,
                });
            } catch (e) {
                logger.error("Store", "Erro ao registrar mensagem fixada", e);
            }
        }
        return null;
    }

    const ignoredTypes = [
        'protocolMessage',
        'senderKeyDistributionMessage',
        'reactionMessage', // Optional: User might want reactions, but usually "kosong" means junk
        'keepInChatMessage',
        // minha versao: mais mensagens tecnicas que viravam "TEXT" vazio na lista
        'messageContextInfo',
        'pollUpdateMessage',
        'encReactionMessage',
        'pinInChatMessage',
        'secretEncryptedMessage', // edicao/resposta de evento criptografada (aparecia "[secretEncrypted]")
        'albumMessage',           // so o "cabecalho" do album; as fotos/videos chegam como mensagens proprias
        'encEventResponseMessage',
        'associatedChildMessage'
    ];

    // If message only contains ignored types, skip (since edit and revoke handled above)
    if (messageKeys.every(k => ignoredTypes.includes(k))) {
        logger.debug("Store", `Skipping technical message: ${keyId} (${messageKeys.join(', ')})`);
        return null;
    }

    // Check if message already exists to avoid duplicates
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    const existingMessage = await prisma.message.findUnique({
        where: { sessionId_keyId: { sessionId: dbSessionId, keyId: keyId! } },
        select: { id: true, status: true }
    });

    if (existingMessage) {
        // Message exists! Update status if changed, but DO NOT re-trigger webhooks/bot
        if (fromMe && existingMessage.status !== 'SENT') {
            await prisma.message.update({
                where: { id: existingMessage.id },
                data: { status: 'SENT' }
            });
        }
        // Return null to indicate "Not New"
        return null;
    }

    // Debug fromMe issue (Keep this for a while)
    if (fromMe === undefined || fromMe === null) {
        logger.warn("Store", `[DEBUG] Message ${keyId} has fromMe=${fromMe}. Key:`, msg.key);
    }

    const messageContent = normalizeMessageContent(msg.message);
    let text = "";
    let messageType = "TEXT";
    let extra: any = undefined; // minha versao: dados estruturados (ex.: contatos encaminhados)

    // Check for interactive message (native flow / viewOnce wrapper)
    const rawMsg = msg.message as any;
    const interactiveMsg = messageContent?.interactiveMessage || 
        rawMsg?.viewOnceMessage?.message?.interactiveMessage || 
        rawMsg?.viewOnceMessageV2?.message?.interactiveMessage;

    // Extract content based on message type
    if (interactiveMsg) {
        messageType = "TEXT";
        const title = interactiveMsg.header?.title ? `*${interactiveMsg.header.title}*\n` : "";
        const body = interactiveMsg.body?.text || "";
        const footer = interactiveMsg.footer?.text ? `\n_${interactiveMsg.footer.text}_` : "";

        let buttonList = "";
        const rawBtns = interactiveMsg.nativeFlowMessage?.buttons || [];
        if (Array.isArray(rawBtns) && rawBtns.length > 0) {
            const btnTitles = rawBtns.map((b: any) => {
                try {
                    const parsed = typeof b.buttonParamsJson === "string" ? JSON.parse(b.buttonParamsJson) : b.buttonParamsJson;
                    return `[🔘 ${parsed?.display_text || parsed?.title || b.name}]`;
                } catch {
                    return `[🔘 ${b.name}]`;
                }
            });
            buttonList = `\n\n${btnTitles.join("  ")}`;
        }

        text = `${title}${body}${footer}${buttonList}`.trim() || "[Interactive Message]";
    } else if (messageContent?.interactiveResponseMessage) {
        messageType = "TEXT";
        const rm = messageContent.interactiveResponseMessage;
        const nativeParams = rm.nativeFlowResponseMessage?.paramsJson;
        let selectedId = "";
        try {
            if (nativeParams) {
                const parsed = JSON.parse(nativeParams);
                selectedId = parsed.id || parsed.item_id || "";
            }
        } catch {}
        const bodyText = rm.body?.text || "";
        const choice = bodyText || selectedId;
        text = choice ? `🔘 [Interactive Response] ${choice}` : "🔘 [Interactive Response]";
    } else if (messageContent?.buttonsResponseMessage) {
        messageType = "TEXT";
        const bm = messageContent.buttonsResponseMessage;
        const choice = bm.selectedDisplayText || bm.selectedButtonId || "";
        text = choice ? `🔘 [Button Response] ${choice}` : "🔘 [Button Response]";
    } else if (messageContent?.listResponseMessage) {
        messageType = "TEXT";
        const lm = messageContent.listResponseMessage;
        const choice = lm.title || lm.singleSelectReply?.selectedRowId || "";
        text = choice ? `📋 [List Response] ${choice}` : "📋 [List Response]";
    } else if (messageContent?.templateButtonReplyMessage) {
        messageType = "TEXT";
        const tm = messageContent.templateButtonReplyMessage;
        const choice = tm.selectedDisplayText || tm.selectedId || "";
        text = choice ? `🔘 [Button Reply] ${choice}` : "🔘 [Button Reply]";
    } else if (messageContent?.conversation) {
        text = messageContent.conversation;
    } else if (messageContent?.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
        // minha versao: previa de link que o WhatsApp ja manda (titulo, descricao, miniatura)
        const previa = previaDoWhatsApp(messageContent.extendedTextMessage);
        if (previa) extra = { ...(extra || {}), previa };
    } else if (messageContent?.imageMessage) {
        messageType = "IMAGE";
        text = messageContent.imageMessage.caption || "";
    } else if (messageContent?.videoMessage) {
        messageType = "VIDEO";
        text = messageContent.videoMessage.caption || "";
    } else if (messageContent?.audioMessage) {
        messageType = "AUDIO";
    } else if (messageContent?.documentMessage) {
        messageType = "DOCUMENT";
        text = messageContent.documentMessage.fileName || "";
    } else if (messageContent?.stickerMessage) {
        messageType = "STICKER";
    } else if (messageContent?.locationMessage) {
        messageType = "LOCATION";
        text = `${messageContent.locationMessage.degreesLatitude},${messageContent.locationMessage.degreesLongitude}`;
    } else if (messageContent?.contactMessage) {
        messageType = "CONTACT";
        text = messageContent.contactMessage.displayName || "";
        extra = { contatos: [lerVcard(messageContent.contactMessage.vcard, messageContent.contactMessage.displayName)] };
    } else if ((messageContent as any)?.ptvMessage) {
        // minha versao: video-bolinha
        messageType = "VIDEO";
    } else if (messageContent?.contactsArrayMessage) {
        messageType = "CONTACT";
        const cs = messageContent.contactsArrayMessage.contacts || [];
        text = messageContent.contactsArrayMessage.displayName || cs.map((c: any) => c.displayName).filter(Boolean).join(", ");
        extra = { contatos: cs.map((c: any) => lerVcard(c.vcard, c.displayName)) };
    } else if (messageContent?.liveLocationMessage) {
        messageType = "LOCATION";
        text = `${messageContent.liveLocationMessage.degreesLatitude},${messageContent.liveLocationMessage.degreesLongitude}`;
    } else {
        // minha versao: tipos que antes ficavam com texto vazio ("No messages yet" na lista)
        const mc: any = messageContent || {};
        const poll = mc.pollCreationMessage || mc.pollCreationMessageV2 || mc.pollCreationMessageV3 || mc.pollCreationMessageV5;
        if (poll) {
            const ops = (poll.options || []).map((o: any) => o.optionName).filter(Boolean);
            text = `📊 Enquete: ${poll.name || ""}${ops.length ? "\n" + ops.map((o: string) => `• ${o}`).join("\n") : ""}`;
        } else if (mc.eventMessage) {
            text = `📅 Evento: ${mc.eventMessage.name || ""}`.trim();
        } else if (mc.groupInviteMessage) {
            text = `👥 Convite para o grupo ${mc.groupInviteMessage.groupName || ""}`.trim();
        } else if (mc.callLogMesssage || mc.callLogMessage || mc.bcallMessage) {
            text = "📞 Chamada";
        } else if (mc.productMessage) {
            text = `🛍️ ${mc.productMessage.product?.title || "Produto"}`;
        } else if (mc.orderMessage) {
            text = "🧾 Pedido";
        } else if (mc.paymentInviteMessage || mc.requestPaymentMessage || mc.sendPaymentMessage) {
            text = "💳 Pagamento";
        } else {
            // pula os tipos tecnicos (senderKeyDistribution etc.); se nao sobrar conteudo real, nao grava
            const k = Object.keys(mc).find((key) => !ignoredTypes.includes(key));
            if (!k) return null;
            text = `[${k.replace(/Message(V\d+)?$/, "")}]`;
        }
    }

    // Determine effective participant for groups
    // Determine effective participant for groups with standard logic
    const isGroup = remoteJid.endsWith("@g.us");
    const remoteJidAlt = msg.key.remoteJidAlt; // LID/Phone JID handling
    let senderJid = fromMe ? undefined : (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

    // Prefer remoteJidAlt for DMs if available (matches webhook logic)
    if (!fromMe && !isGroup && remoteJidAlt) {
        senderJid = remoteJidAlt;
    }

    // --- Normalize LID JIDs to @s.whatsapp.net ---
    let normalizedRemoteJid = remoteJid;
    if (isLidJid(remoteJid)) {
        // minha versao: sem o telefone na mensagem (comum nas MINHAS mensagens para um numero novo),
        // pergunta ao mapa do Baileys antes de cair no banco; achando, ja guarda o vinculo
        let alt = remoteJidAlt && !isLidJid(remoteJidAlt) ? remoteJidAlt : null;
        if (!alt && !isGroup) {
            alt = await telefoneDoLid(sock, remoteJid);
            if (alt) await vincularLidAoTelefone(dbSessionId, remoteJid, alt).catch(() => {});
        }
        normalizedRemoteJid = await resolveToPhoneJid(remoteJid, dbSessionId, alt);
    }
    if (senderJid && isLidJid(senderJid)) {
        senderJid = await resolveToPhoneJid(senderJid, dbSessionId, remoteJidAlt);
    }


    // minha versao: midia. Ao vivo tenta baixar na hora (com tempo limite); historico nao espera.
    // O que nao baixou agora grava sem arquivo e vai para a fila (lib/midia-fila.ts), que tenta de novo
    // e avisa a tela quando o arquivo chegar. Antes um download lento ou com erro travava ou perdia a mensagem.
    let fileUrl: string | null = null;
    let midiaNaFila = false;
    if (TIPOS_MIDIA.includes(messageType)) {
        if (aoVivo) {
            try {
                fileUrl = await downloadAndSaveMedia(msg, sessionId, { sock, timeoutMs: 20_000 });
            } catch (e) {
                logger.error("Store", "Error downloading media in store", e);
            }
        }
        if (!fileUrl) {
            midiaNaFila = true;
            extra = { ...(extra || {}), midiaPendente: descritorMidia(msg) };
        } else {
            // minha versao: guarda os dados de download; se o arquivo sumir do disco, da para baixar de novo
            extra = { ...(extra || {}), midiaOrigem: descritorMidia(msg) };
        }
    }

    // Extract contextInfo (quoted message ID)
    let quoteId: string | null = null;
    if (msg.message) {
        const msgObj = msg.message as any;
        for (const key of Object.keys(msgObj)) {
            const inner = msgObj[key];
            if (inner && typeof inner === 'object' && inner !== null && 'contextInfo' in inner) {
                const contextInfo = (inner as any).contextInfo;
                // minha versao: mensagem encaminhada (o WhatsApp mostra "Encaminhada"; 4+ vezes = "com frequencia")
                if (contextInfo?.isForwarded) {
                    const vezes = Number(contextInfo.forwardingScore) || 1;
                    extra = { ...(extra || {}), encaminhada: { vezes } };
                }
                if (contextInfo?.stanzaId) {
                    quoteId = contextInfo.stanzaId;
                    break;
                }
            }
        }
    }

    try {
        const newMessage = await prisma.message.create({
            data: {
                sessionId: dbSessionId,
                remoteJid: normalizeJid(normalizedRemoteJid),
                senderJid,
                fromMe: fromMe || false,
                keyId,
                pushName,
                type: messageType as any,
                content: text,
                mediaUrl: fileUrl, // Save Media URL
                status: fromMe ? "SENT" : "PENDING",
                timestamp,
                quoteId,
                sentBy: fromMe ? (nomeAgentePendente(keyId) || null) : null, // minha versao: atendente
                // minha versao: mensagem minha ao vivo -> saiu pela plataforma ou FORA dela (celular/outro aparelho)
                origemEnvio: fromMe && aoVivo ? (enviadaPelaPlataforma(keyId) || nomeAgentePendente(keyId) ? "PLATAFORMA" : "FORA") : null,
                ...(extra ? { extra } : {})
            }
        });
        if (midiaNaFila) agendarDownload({ sessionId, dbSessionId, msg });

        // Ensure contact exists (Upsert Contact)
        const finalRemoteJid = normalizeJid(normalizedRemoteJid);
        if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes('status@broadcast')) {
            const contactJid = finalRemoteJid; // Use fully normalized JID
            const contactData: any = {
                sessionId: dbSessionId,
                jid: contactJid
            };

            // Only update name/notify if message is FROM the contact (not from me)
            if (!fromMe) {
                if (pushName) contactData.notify = pushName;
                if (pushName) contactData.name = pushName;
            }

            // minha versao: a mensagem JA foi gravada. Um erro aqui (MariaDB 1020 quando chegam varias mensagens
            // do mesmo contato juntas) fazia a mensagem nao ir ao vivo para o painel, que so a mostrava ao recarregar.
            await comRetry1020(() => prisma.contact.upsert({
                where: { sessionId_jid: { sessionId: dbSessionId, jid: contactJid } },
                create: {
                    sessionId: dbSessionId,
                    jid: contactJid,
                    notify: !fromMe ? pushName : undefined,
                    name: !fromMe ? pushName : undefined,
                    // @ts-ignore
                    remoteJidAlt: remoteJidAlt || undefined
                },
                update: !fromMe ? {
                    notify: pushName,
                    // @ts-ignore
                    remoteJidAlt: remoteJidAlt || undefined
                } : {}
            })).catch((e) => logger.warn("Store", `Contato ${contactJid} nao atualizado (a mensagem foi salva): ${e?.message || e}`));

            // Welcome Message Logic
            if (!fromMe && triggerWebhook && config?.welcomeMessage && sock) {
                // Let's check if message count for this contact is exactly 1 (the one we just saved)
                const msgCount = await prisma.message.count({
                    where: { sessionId: dbSessionId, remoteJid: finalRemoteJid }
                });

                if (msgCount === 1) {
                    logger.info("Store", `Sending welcome message to ${finalRemoteJid}`);
                    await sock.sendMessage(finalRemoteJid, { text: config.welcomeMessage });
                }
            }
        }

        // Trigger webhook for new messages only (not history sync)
        if (triggerWebhook) {
            if (fromMe) {
                onMessageSent(sessionId, msg, fileUrl).catch(e => logger.error("Webhook", "Error in onMessageSent", e));
            } else {
                onMessageReceived(sessionId, msg, fileUrl).catch(e => logger.error("Webhook", "Error in onMessageReceived", e));
            }
        }

        return newMessage;
    } catch (e: any) {
        // minha versao: P2002 = a mesma mensagem chegou por dois caminhos ao mesmo tempo (historico e ao vivo): ja esta salva
        if (e?.code === "P2002") return null;
        logger.error("Store", "Error saving message query", e);
        throw e;
    }
}

// minha versao: tira o sufixo de aparelho ("123:4@lid" -> "123@lid")
function semAparelho(jid: string): string {
    return jid.replace(/:\d+(?=@)/, "");
}

/** telefone por tras de um @lid, segundo o mapa que o proprio Baileys mantem (ou null) */
export async function telefoneDoLid(sock: WASocket | undefined, lid: string): Promise<string | null> {
    try {
        const pn = await (sock as any)?.signalRepository?.lidMapping?.getPNForLID?.(lid);
        if (typeof pn !== "string" || !pn || isLidJid(pn)) return null;
        return normalizeJid(semAparelho(pn));
    } catch {
        return null;
    }
}

/**
 * minha versao: grava "este @lid e este telefone" e junta a conversa: as mensagens que ficaram gravadas no @lid
 * passam para o telefone, e o contato (se existir) ganha o lid. So cria contato novo quando ja havia conversa
 * no @lid, para nao encher a agenda com cada membro de grupo que o WhatsApp mapeia.
 */
export async function vincularLidAoTelefone(dbSessionId: string, lidBruto: string, pnBruto: string): Promise<void> {
    const lid = semAparelho(lidBruto);
    const pn = normalizeJid(semAparelho(pnBruto));
    if (!isLidJid(lid) || isLidJid(pn) || !pn.endsWith("@s.whatsapp.net")) return;

    const movidas = await prisma.message.updateMany({ where: { sessionId: dbSessionId, remoteJid: lid }, data: { remoteJid: pn } });
    // (lid vazio precisa do OR: no SQL, "diferente de X" nao pega NULL)
    const atualizado = await prisma.contact.updateMany({ where: { sessionId: dbSessionId, jid: pn, OR: [{ lid: null }, { NOT: { lid } }] }, data: { lid } });
    // contato que estava gravado pelo proprio @lid: aponta para o telefone
    await prisma.contact.updateMany({ where: { sessionId: dbSessionId, jid: lid }, data: { remoteJidAlt: pn } });
    if (movidas.count > 0 && atualizado.count === 0) {
        await prisma.contact.upsert({
            where: { sessionId_jid: { sessionId: dbSessionId, jid: pn } },
            update: { lid },
            create: { sessionId: dbSessionId, jid: pn, lid },
        });
    }
    if (movidas.count > 0) logger.info("Store", `Conversa ${lid} juntada a ${pn} (${movidas.count} mensagens)`);
}
