import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeJid } from "@/lib/jid-utils";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import { MODO_DEMO, MENSAGEM_DEMO } from "@/lib/demo";

// minha versao: sem conexao (ou modo demonstracao, que nunca conecta)
const erroSemConexao = () => new Error(MODO_DEMO ? MENSAGEM_DEMO : "WhatsApp session is disconnected or not found");
import Sticker from "wa-sticker-formatter";
import type { InteractiveMessagePayload, AlbumItem } from "./interactive";
import { generateMessageIDV2 } from "@whiskeysockets/baileys";
import { guardarMidiaEnviada } from "@/lib/midia-fila";
import { estadosDe } from "./store/estado-chat";

/**
 * Chat list filter:
 * - "all": every chat except status/broadcast lists
 * - "private": only 1:1 chats (no groups, broadcasts or newsletters)
 * - "groups": only group chats (@g.us)
 */
// minha versao: "archived" = so as conversas arquivadas (as outras abas escondem as arquivadas, como no WhatsApp)
export type ChatListFilter = "all" | "private" | "groups" | "archived";

const CHAT_FILTER_SQL: Record<ChatListFilter, string> = {
    all: "AND m1.remoteJid NOT LIKE '%@broadcast'",
    private: "AND m1.remoteJid NOT LIKE '%@g.us' AND m1.remoteJid NOT LIKE '%@broadcast' AND m1.remoteJid NOT LIKE '%@newsletter'",
    groups: "AND m1.remoteJid LIKE '%@g.us'",
    archived: "AND m1.remoteJid NOT LIKE '%@broadcast'",
};

type LinhaUltima = { remoteJid: string; content: string | null; timestamp: Date; type: string; fromMe: any; status: string; keyId: string };

/** ultima mensagem de cada conversa, com filtros extras de JID (dentro/fora de uma lista) */
async function ultimasMensagens(dbSessionId: string, opts: {
    limit?: number; before?: string; filter?: ChatListFilter; dentro?: string[]; fora?: string[];
}): Promise<LinhaUltima[]> {
    if (opts.dentro && opts.dentro.length === 0) return [];
    const params: any[] = [dbSessionId, dbSessionId];
    let extra = "";
    if (opts.before) { extra += " AND m1.timestamp < ?"; params.push(new Date(opts.before)); }
    if (opts.dentro?.length) { extra += ` AND m1.remoteJid IN (${opts.dentro.map(() => "?").join(",")})`; params.push(...opts.dentro); }
    if (opts.fora?.length) { extra += ` AND m1.remoteJid NOT IN (${opts.fora.map(() => "?").join(",")})`; params.push(...opts.fora); }
    if (opts.limit) params.push(opts.limit);
    const filtro = opts.filter && Object.hasOwn(CHAT_FILTER_SQL, opts.filter) ? CHAT_FILTER_SQL[opts.filter] : "";
    return prisma.$queryRawUnsafe<LinhaUltima[]>(`
        SELECT m1.remoteJid, m1.content, m1.timestamp, m1.type, m1.fromMe, m1.status, m1.keyId
        FROM \`Message\` m1
        INNER JOIN (
            SELECT remoteJid, MAX(timestamp) as max_ts
            FROM \`Message\`
            WHERE sessionId = ?
            GROUP BY remoteJid
        ) m2 ON m1.remoteJid = m2.remoteJid AND m1.timestamp = m2.max_ts
        WHERE m1.sessionId = ?
        ${extra}
        ${filtro}
        ORDER BY m1.timestamp DESC
        ${opts.limit ? "LIMIT ?" : ""}
    `, ...params);
}

export class ChatService {
    /**
     * Get active chats list for a session with last message preview.
     * Cursor-based pagination — `before` is ISO timestamp of last seen chat.
     * Returns chats with last message timestamp < before (older).
     * `filter` is optional; when omitted no JID filtering is applied (API behavior).
     */
    static async getChatsList(
        dbSessionId: string,
        limit = 50,
        before?: string,
        search?: string,
        filter?: ChatListFilter
    ) {
        // 1. Get latest message per remoteJid with cursor pagination
        // minha versao: o painel (com filtro) esconde as arquivadas das abas normais, mostra so elas na aba
        // "Arquivadas" e poe as fixadas no topo da 1a pagina. A API sem filtro continua igual (tudo, por data).
        let rawLastMessages: LinhaUltima[];
        // minha versao: com busca, procura em TODAS as conversas (nome do contato/grupo e numero), no banco.
        // Antes filtrava so as 50 mais recentes ja carregadas, e conversa mais antiga nunca aparecia.
        const termo = (search || "").trim().slice(0, 100);
        if (termo) {
            let dentro = await this.jidsDaBusca(dbSessionId, termo);
            if (filter === "archived" && dentro.length) {
                dentro = (await prisma.chatEstado.findMany({
                    where: { sessionId: dbSessionId, arquivada: true, jid: { in: dentro } }, select: { jid: true },
                })).map((e) => e.jid);
            }
            rawLastMessages = await ultimasMensagens(dbSessionId, { dentro, filter, limit: 100 });
        } else if (!filter) {
            rawLastMessages = await ultimasMensagens(dbSessionId, { limit, before });
        } else {
            const estados = await prisma.chatEstado.findMany({
                where: { sessionId: dbSessionId, OR: [{ arquivada: true }, { fixadaEm: { not: null } }] },
                select: { jid: true, arquivada: true, fixadaEm: true },
            });
            const arquivadas = estados.filter((e) => e.arquivada).map((e) => e.jid);
            if (filter === "archived") {
                rawLastMessages = await ultimasMensagens(dbSessionId, { limit, before, filter, dentro: arquivadas });
            } else {
                const fixadas = estados.filter((e) => !e.arquivada && e.fixadaEm)
                    .sort((a, b) => b.fixadaEm!.getTime() - a.fixadaEm!.getTime()).map((e) => e.jid);
                const topo = !before && fixadas.length
                    ? (await ultimasMensagens(dbSessionId, { filter, dentro: fixadas }))
                        .sort((a, b) => fixadas.indexOf(a.remoteJid) - fixadas.indexOf(b.remoteJid))
                    : [];
                const resto = await ultimasMensagens(dbSessionId, { limit, before, filter, fora: [...arquivadas, ...fixadas] });
                rawLastMessages = [...topo, ...resto];
            }
        }

        // Fast return if no messages
        if (rawLastMessages.length === 0) return [];

        // 2. Batch fetch contacts & groups ONLY for JIDs that have messages
        const jids = rawLastMessages.map(m => m.remoteJid);
        const [contacts, groups] = await Promise.all([
            prisma.contact.findMany({
                where: { sessionId: dbSessionId, jid: { in: jids } },
                select: { jid: true, name: true, notify: true, profilePic: true }
            }),
            prisma.group.findMany({
                where: { sessionId: dbSessionId, jid: { in: jids } },
                select: { jid: true, subject: true }
            })
        ]);

        // Build lookup map
        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null }>();
        contacts.forEach(c => infoMap.set(c.jid, { name: c.name, notify: c.notify, profilePic: c.profilePic }));
        groups.forEach(g => infoMap.set(g.jid, { name: g.subject, notify: g.subject, profilePic: null }));

        // minha versao: resolve @lid -> contato de telefone nomeado (o campo Contact.lid guarda o @lid)
        const lidJids = jids.filter(j => j.endsWith('@lid') && !infoMap.get(j)?.name);
        if (lidJids.length) {
            const lidContacts = await prisma.contact.findMany({
                where: { sessionId: dbSessionId, lid: { in: lidJids } },
                select: { lid: true, name: true, notify: true, profilePic: true }
            });
            lidContacts.forEach(c => {
                if (c.lid && (c.name || c.notify)) {
                    const prev = infoMap.get(c.lid) || { name: null, notify: null, profilePic: null };
                    infoMap.set(c.lid, { name: prev.name || c.name, notify: prev.notify || c.notify, profilePic: prev.profilePic || c.profilePic });
                }
            });
        }

        // minha versao: nao lidas = recebidas depois de max(ultima abertura no painel, minha ultima mensagem)
        const naoLidas = new Map<string, number>();
        try {
            const linhas = await prisma.$queryRaw<Array<{ remoteJid: string; n: bigint | number }>>`
                SELECT m.remoteJid, COUNT(*) AS n
                FROM \`Message\` m
                LEFT JOIN \`ChatLeitura\` c ON c.sessionId = m.sessionId AND c.jid = m.remoteJid
                LEFT JOIN (
                    SELECT remoteJid, MAX(timestamp) AS ultimaMinha FROM \`Message\`
                    WHERE sessionId = ${dbSessionId} AND fromMe = 1 AND remoteJid IN (${Prisma.join(jids)})
                    GROUP BY remoteJid
                ) e ON e.remoteJid = m.remoteJid
                WHERE m.sessionId = ${dbSessionId} AND m.fromMe = 0 AND m.remoteJid IN (${Prisma.join(jids)})
                  AND m.status <> 'READ' -- minha versao: lida no celular/WhatsApp Web tambem conta como lida
                  AND m.timestamp > GREATEST(COALESCE(c.lidoEm, '1970-01-01'), COALESCE(e.ultimaMinha, '1970-01-01'))
                GROUP BY m.remoteJid`;
            linhas.forEach((l) => naoLidas.set(l.remoteJid, Number(l.n)));
        } catch (e) {
            console.error("Falha ao contar nao lidas:", e);
        }
        // "marcar como nao lida" (painel ou celular)
        const marcadas = new Set<string>();
        try {
            (await prisma.chatLeitura.findMany({
                where: { sessionId: dbSessionId, jid: { in: jids }, naoLida: true },
                select: { jid: true },
            })).forEach((c) => marcadas.add(c.jid));
        } catch { /* coluna nova ainda nao existe */ }

        // minha versao: arquivada / silenciada / fixada de cada conversa
        let estados: Awaited<ReturnType<typeof estadosDe>> = new Map();
        try { estados = await estadosDe(dbSessionId, jids); } catch (e) { console.error("Falha ao ler estado das conversas:", e); }

        // 3. Build result array (already sorted by SQL DESC)
        const result: any[] = [];
        const seenJids = new Set<string>();
        for (const msg of rawLastMessages) {
            if (seenJids.has(msg.remoteJid)) continue;
            seenJids.add(msg.remoteJid);

            const info = infoMap.get(msg.remoteJid);
            result.push({
                jid: msg.remoteJid,
                name: info?.name || null,
                notify: info?.notify || null,
                profilePic: info?.profilePic || null,
                unread: naoLidas.get(msg.remoteJid) || 0,
                naoLida: marcadas.has(msg.remoteJid),
                ...(estados.get(msg.remoteJid) || { arquivada: false, silenciada: false, silenciadaAte: null, fixada: false, fixadaEm: null }),
                lastMessage: {
                    content: msg.content,
                    timestamp: msg.timestamp instanceof Date
                        ? msg.timestamp.toISOString()
                        : String(msg.timestamp),
                    type: msg.type,
                    fromMe: msg.fromMe === true || msg.fromMe === 1 || msg.fromMe === "1",
                    status: msg.status,
                    keyId: msg.keyId
                }
            });
        }

        // (a busca ja foi feita no banco, no passo 1)
        return result;
    }

    /** minha versao: variantes de numero para a busca (so digitos, com e sem o 9 depois do DDD, com e sem o 55) */
    static variantesNumero(termo: string): string[] {
        const d = termo.replace(/\D/g, "");
        if (d.length < 4) return [];
        const v = new Set([d]);
        const local = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
        v.add(local);
        if (local.length === 11 && local[2] === "9") v.add(local.slice(0, 2) + local.slice(3)); // celular sem o 9
        if (local.length === 10) v.add(local.slice(0, 2) + "9" + local.slice(2));             // e com o 9
        return [...v];
    }

    /** minha versao: JIDs de conversa que casam com a busca (contato, grupo, numero), com @lid e alternativos */
    private static async jidsDaBusca(dbSessionId: string, termo: string): Promise<string[]> {
        const numeros = this.variantesNumero(termo);
        const temTexto = /\p{L}/u.test(termo);
        const [contatos, grupos, porNumero] = await Promise.all([
            prisma.contact.findMany({
                where: {
                    sessionId: dbSessionId,
                    OR: [
                        ...(temTexto || !numeros.length ? [{ name: { contains: termo } }, { notify: { contains: termo } }, { verifiedName: { contains: termo } }] : []),
                        ...numeros.map((n) => ({ jid: { contains: n } })),
                    ],
                },
                select: { jid: true, lid: true, remoteJidAlt: true },
                take: 300,
            }),
            prisma.group.findMany({ where: { sessionId: dbSessionId, subject: { contains: termo } }, select: { jid: true }, take: 100 }),
            // conversa sem contato salvo: procura o numero direto no JID das mensagens
            numeros.length
                ? prisma.message.findMany({
                    where: { sessionId: dbSessionId, OR: numeros.map((n) => ({ remoteJid: { contains: n } })) },
                    select: { remoteJid: true }, distinct: ["remoteJid"], take: 100,
                })
                : Promise.resolve([] as { remoteJid: string }[]),
        ]);
        const jids = new Set<string>();
        for (const c of contatos) {
            for (const j of [c.jid, c.lid, c.remoteJidAlt]) {
                if (j) jids.add(j);
            }
        }
        grupos.forEach((g) => jids.add(g.jid));
        porNumero.forEach((m) => jids.add(m.remoteJid));
        return [...jids];
    }

    /**
     * minha versao: busca em TODAS as conversas (como o WhatsApp Web): contatos sem conversa e mensagens com o texto.
     * As conversas em si vem do getChatsList(search).
     */
    /**
     * minha versao: encaminha uma mensagem ja gravada para outras conversas (ate 5 por vez).
     * Reenvia o conteudo (texto ou o arquivo de midia guardado) com a marca "Encaminhada", como o WhatsApp faz.
     * Devolve o resultado por destino; um destino que falha nao impede os outros.
     */
    static async encaminhar(sessionId: string, dbSessionId: string, keyId: string, destinos: string[]) {
        const msg = await prisma.message.findFirst({
            where: { sessionId: dbSessionId, keyId },
            select: { type: true, content: true, mediaUrl: true, extra: true },
        });
        if (!msg) throw new Error("Mensagem não encontrada");
        if ((msg.extra as any)?.apagada) throw new Error("Mensagem apagada não pode ser encaminhada");
        const vezes = Math.min(127, (Number((msg.extra as any)?.encaminhada?.vezes) || 0) + 1);

        // arquivo da midia (do disco; nunca uma URL de fora)
        let arquivo: Buffer | null = null;
        let nome = "";
        if (msg.type !== "TEXT") {
            const { nomeDoMediaUrl, localizarMidia } = await import("@/lib/pasta-midia");
            nome = nomeDoMediaUrl(msg.mediaUrl) || "";
            const caminho = nome ? await localizarMidia(nome) : null;
            if (!caminho) throw new Error("O arquivo desta mídia não está mais no servidor");
            const { readFile } = await import("node:fs/promises");
            arquivo = await readFile(caminho);
        }
        const ext = nome.split(".").pop()?.toLowerCase() || "";
        const MIMES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", pdf: "application/pdf" };

        const resultados: { jid: string; ok: boolean; erro?: string; envio?: any }[] = [];
        for (const jid of destinos) {
            try {
                let envio: any;
                if (msg.type === "TEXT") {
                    const instance = waManager.getInstance(sessionId);
                    if (!instance?.socket) throw erroSemConexao();
                    envio = await instance.socket.sendMessage(jid, {
                        text: msg.content || "",
                        contextInfo: { isForwarded: true, forwardingScore: vezes },
                    });
                } else {
                    const tipo = ({ IMAGE: "image", VIDEO: "video", STICKER: "sticker", DOCUMENT: "document" } as Record<string, string>)[msg.type]
                        || (msg.type === "AUDIO" ? (["ogg", "opus"].includes(ext) ? "voz-pronta" : "audio") : "document");
                    envio = await this.sendMediaMessage(sessionId, jid, arquivo!, tipo, MIMES[ext] || "application/octet-stream",
                        nome, msg.type === "IMAGE" || msg.type === "VIDEO" ? (msg.content || "") : "", { encaminhada: vezes });
                }
                resultados.push({ jid, ok: true, envio });
            } catch (e: any) {
                resultados.push({ jid, ok: false, erro: e?.message || "falhou" });
            }
        }
        return resultados;
    }

    static async buscarGeral(dbSessionId: string, termo: string) {
        const t = (termo || "").trim().slice(0, 100);
        if (t.length < 2) return { contatos: [], mensagens: [] };
        const numeros = this.variantesNumero(t);
        const temTexto = /\p{L}/u.test(t);
        const [contatos, mensagens] = await Promise.all([
            prisma.contact.findMany({
                where: {
                    sessionId: dbSessionId,
                    jid: { endsWith: "@s.whatsapp.net" },
                    OR: [
                        ...(temTexto || !numeros.length ? [{ name: { contains: t } }, { notify: { contains: t } }, { verifiedName: { contains: t } }] : []),
                        ...numeros.map((n) => ({ jid: { contains: n } })),
                    ],
                },
                select: { jid: true, name: true, notify: true, verifiedName: true },
                orderBy: { name: "asc" },
                take: 30,
            }),
            t.length >= 3
                ? prisma.message.findMany({
                    where: { sessionId: dbSessionId, content: { contains: t }, remoteJid: { not: { endsWith: "@broadcast" } } },
                    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
                    select: { keyId: true, remoteJid: true, content: true, fromMe: true, pushName: true, timestamp: true },
                    take: 30,
                })
                : Promise.resolve([] as any[]),
        ]);
        // nome de cada conversa das mensagens achadas
        const jidsMsg = [...new Set(mensagens.map((m: any) => m.remoteJid))];
        const nomes = new Map<string, string>();
        if (jidsMsg.length) {
            const [cs, gs] = await Promise.all([
                prisma.contact.findMany({ where: { sessionId: dbSessionId, OR: [{ jid: { in: jidsMsg } }, { lid: { in: jidsMsg } }] }, select: { jid: true, lid: true, name: true, notify: true } }),
                prisma.group.findMany({ where: { sessionId: dbSessionId, jid: { in: jidsMsg } }, select: { jid: true, subject: true } }),
            ]);
            cs.forEach((c) => { const n = c.name || c.notify; if (n) { nomes.set(c.jid, n); if (c.lid) nomes.set(c.lid, n); } });
            gs.forEach((g) => { if (g.subject) nomes.set(g.jid, g.subject); });
        }
        return {
            contatos: contatos.map((c) => ({ jid: c.jid, nome: c.name || c.notify || c.verifiedName || null, salvo: !!c.name })),
            mensagens: mensagens.map((m: any) => ({
                keyId: m.keyId, remoteJid: m.remoteJid, content: m.content, fromMe: m.fromMe, pushName: m.pushName,
                nomeConversa: nomes.get(m.remoteJid) || null,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
            })),
        };
    }

    /**
     * minha versao: todos os JIDs que representam a mesma conversa (telefone + @lid + alt),
     * para a busca e o "pular ate a mensagem" acharem tudo, igual ao getMessages.
     */
    private static async jidsDaConversa(dbSessionId: string, jid: string): Promise<string[]> {
        const normalizedJid = normalizeJid(jid);
        const contact = await prisma.contact.findFirst({
            where: { sessionId: dbSessionId, OR: [{ jid }, { lid: jid }, { remoteJidAlt: jid }, { jid: normalizedJid }] },
            select: { jid: true, lid: true, remoteJidAlt: true }
        });
        const set = new Set([jid, normalizedJid]);
        if (contact) {
            if (contact.jid) set.add(contact.jid);
            if (contact.lid) set.add(contact.lid);
            if (contact.remoteJidAlt) set.add(contact.remoteJidAlt);
        }
        return Array.from(set);
    }

    /**
     * minha versao: enriquece uma lista de mensagens (citacao + nome do remetente), PRESERVANDO a ordem recebida.
     * Extraido do getMessages para a busca/salto montarem as mensagens identicas ao chat normal.
     */
    private static async enriquecer(dbSessionId: string, messages: any[]): Promise<any[]> {
        const quoteIds = messages.map(m => m.quoteId).filter((id): id is string => !!id);
        const quotedMap = new Map<string, any>();
        if (quoteIds.length > 0) {
            try {
                const quoted = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, keyId: { in: quoteIds } },
                    select: { keyId: true, content: true, fromMe: true, senderJid: true, pushName: true, sentBy: true, type: true }
                });
                quoted.forEach(qm => quotedMap.set(qm.keyId, qm));
            } catch (e) {
                console.error("Failed to batch load quoted messages:", e);
            }
        }

        const senderJids = [...new Set([
            ...messages.map((m: any) => m.senderJid),
            ...[...quotedMap.values()].map((q) => q.senderJid)
        ].filter((j: any): j is string => !!j))];
        const senderNameMap = new Map<string, string>();
        if (senderJids.length) {
            const lidSenders = senderJids.filter((j: string) => j.endsWith('@lid'));
            const [direct, viaLid] = await Promise.all([
                prisma.contact.findMany({ where: { sessionId: dbSessionId, jid: { in: senderJids } }, select: { jid: true, name: true, notify: true } }),
                lidSenders.length ? prisma.contact.findMany({ where: { sessionId: dbSessionId, lid: { in: lidSenders } }, select: { lid: true, name: true, notify: true } }) : Promise.resolve([] as any[])
            ]);
            direct.forEach((c: any) => { const n = c.name || c.notify; if (n) senderNameMap.set(c.jid, n); });
            viaLid.forEach((c: any) => { const n = c.name || c.notify; if (n && c.lid && !senderNameMap.has(c.lid)) senderNameMap.set(c.lid, n); });
        }

        return messages.map((m: any) => {
            const quoted = m.quoteId ? quotedMap.get(m.quoteId) : undefined;
            return {
                ...m,
                senderName: m.senderJid ? (senderNameMap.get(m.senderJid) || null) : null,
                quoted: quoted ? {
                    keyId: m.quoteId,
                    content: quoted.content,
                    fromMe: quoted.fromMe,
                    senderJid: quoted.senderJid,
                    pushName: quoted.pushName,
                    senderName: quoted.senderJid ? (senderNameMap.get(quoted.senderJid) || null) : null,
                    sentBy: quoted.sentBy,
                    type: quoted.type
                } : null
            };
        });
    }

    /**
     * Get messages for a specific chat with cursor pagination (infinite scroll).
     * @param before ISO timestamp — load messages older than this
     * @param limit max messages to return
     */
    static async getMessages(
        dbSessionId: string,
        jid: string,
        limit = 50,
        before?: string
    ) {
        const queryJids = await this.jidsDaConversa(dbSessionId, jid);
        const where: any = { sessionId: dbSessionId, remoteJid: { in: queryJids } };
        if (before) where.timestamp = { lt: new Date(before) };

        const messages = await prisma.message.findMany({
            where,
            // minha versao: mesmo segundo (mensagens antigas) -> ordem de gravacao (o id cuid cresce com o tempo)
            orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
            take: limit + 1 // fetch 1 extra to know if there's more
        });

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        // enriquece e devolve em ordem cronologica (mais antiga primeiro)
        const enriquecidas = await this.enriquecer(dbSessionId, messages.reverse());
        return { messages: enriquecidas, hasMore };
    }

    /**
     * minha versao: busca mensagens DENTRO de uma conversa (texto/legenda), mais recentes primeiro, paginada.
     * O WhatsApp chama de "procurar na conversa". So acha o que tem texto (midia sem legenda nao entra).
     */
    static async buscarNaConversa(dbSessionId: string, jid: string, q: string, limit = 30, page = 1) {
        const termo = (q || "").trim();
        if (!termo) return { resultados: [], total: 0, pagina: 1, paginas: 0 };
        const jids = await this.jidsDaConversa(dbSessionId, jid);
        const where: any = { sessionId: dbSessionId, remoteJid: { in: jids }, content: { contains: termo } };
        const [rows, total] = await Promise.all([
            prisma.message.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                take: limit,
                skip: (Math.max(1, page) - 1) * limit,
                select: { keyId: true, content: true, type: true, fromMe: true, senderJid: true, pushName: true, timestamp: true }
            }),
            prisma.message.count({ where })
        ]);
        // nome de quem enviou (para mostrar no resultado, em grupo)
        const enriquecidas = await this.enriquecer(dbSessionId, rows as any[]);
        return {
            resultados: enriquecidas.map((m: any) => ({
                keyId: m.keyId, content: m.content, type: m.type, fromMe: m.fromMe,
                senderName: m.senderName, pushName: m.pushName,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp)
            })),
            total, pagina: Math.max(1, page), paginas: Math.ceil(total / limit)
        };
    }

    /**
     * minha versao: janela de mensagens AO REDOR de uma mensagem (para "pular ate" um resultado da busca,
     * mesmo que seja antigo e nao esteja carregado). Carrega `raio` antes + a mensagem + `raio` depois.
     * Diz se ainda ha mais antigas/mais novas fora da janela (para o scroll e o botao "voltar ao fim").
     */
    static async getMensagensAoRedor(dbSessionId: string, jid: string, keyId: string, raio = 25) {
        const jids = await this.jidsDaConversa(dbSessionId, jid);
        const inJids = { in: jids };
        const alvo = await prisma.message.findFirst({
            where: { sessionId: dbSessionId, remoteJid: inJids, keyId },
            select: { timestamp: true }
        });
        if (!alvo) return { messages: [], temMaisAntigas: false, temMaisNovas: false, achou: false };

        const [antigas, novas] = await Promise.all([
            prisma.message.findMany({
                where: { sessionId: dbSessionId, remoteJid: inJids, timestamp: { lte: alvo.timestamp } },
                orderBy: [{ timestamp: 'desc' }, { keyId: 'desc' }], take: raio + 1
            }),
            prisma.message.findMany({
                where: { sessionId: dbSessionId, remoteJid: inJids, timestamp: { gt: alvo.timestamp } },
                orderBy: [{ timestamp: 'asc' }, { keyId: 'asc' }], take: raio
            })
        ]);

        // antigas vem desc (inclui a alvo); junta em ordem cronologica e tira repetida
        const janela = [...antigas].reverse().concat(novas);
        const vistos = new Set<string>();
        const unicas = janela.filter((m) => (vistos.has(m.keyId) ? false : (vistos.add(m.keyId), true)));
        const enriquecidas = await this.enriquecer(dbSessionId, unicas);

        const primeira = unicas[0]?.timestamp;
        const ultima = unicas[unicas.length - 1]?.timestamp;
        const [maisAntigas, maisNovas] = await Promise.all([
            primeira ? prisma.message.count({ where: { sessionId: dbSessionId, remoteJid: inJids, timestamp: { lt: primeira } } }) : Promise.resolve(0),
            ultima ? prisma.message.count({ where: { sessionId: dbSessionId, remoteJid: inJids, timestamp: { gt: ultima } } }) : Promise.resolve(0)
        ]);

        return {
            messages: enriquecidas.map((m: any) => ({ ...m, timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp) })),
            temMaisAntigas: maisAntigas > 0,
            temMaisNovas: maisNovas > 0,
            achou: true
        };
    }

    /**
     * minha versao: reagir a uma mensagem com emoji (emoji "" = remover a reacao).
     * A chave e montada como na citacao (sendTextMessage): em grupo, o participant e quem enviou.
     */
    static async reagir(sessionId: string, keyId: string, emoji: string) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) throw new Error("A sessão do WhatsApp está desconectada");
        const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!dbSession) throw new Error("Sessão não encontrada");
        const alvo = await prisma.message.findFirst({
            where: { sessionId: dbSession.id, keyId },
            select: { keyId: true, remoteJid: true, fromMe: true, senderJid: true }
        });
        if (!alvo) throw new Error("Mensagem não encontrada");
        const isGroup = alvo.remoteJid.endsWith("@g.us");
        let participant: string | undefined;
        if (isGroup) {
            const raw = alvo.fromMe ? instance.socket.user?.id : alvo.senderJid;
            if (raw) {
                const [u, d] = raw.split("@");
                participant = d ? `${u.split(":")[0]}@${d}` : u;
            }
        }
        return instance.socket.sendMessage(alvo.remoteJid, {
            react: { text: emoji, key: { remoteJid: alvo.remoteJid, fromMe: alvo.fromMe, id: alvo.keyId, ...(participant ? { participant } : {}) } }
        });
    }

    /**
     * minha versao: prepara o conteudo antes do Baileys: texto puro vira { text }, text com midia vira caption,
     * midia por URL e baixada pelo filtro seguro (safeFetchBuffer) e mencoes entram no texto.
     * Usado pelo envio do painel, por /send e pelas rotas /reply (antes /reply mandava o objeto cru ao WhatsApp).
     */
    static async prepararConteudo(messagePayload: any, mentions?: string[]): Promise<any> {
        let msgPayload: any = typeof messagePayload === "string" ? { text: messagePayload } : { ...messagePayload };

        // Normalize "text" to "caption" if a media message is sent with "text"
        if (msgPayload.text && (msgPayload.image || msgPayload.video || msgPayload.document || msgPayload.audio)) {
            if (!msgPayload.caption) {
                msgPayload.caption = msgPayload.text;
            }
            delete msgPayload.text;
        }

        const { safeFetchBuffer } = await import("@/lib/security");

        if (msgPayload.sticker && (msgPayload.sticker.url || typeof msgPayload.sticker === 'string')) {
            const url = msgPayload.sticker.url || msgPayload.sticker;
            try {
                const { buffer } = await safeFetchBuffer(url, { maxBytes: 10 * 1024 * 1024 });
                const sticker = new Sticker(buffer, {
                    pack: msgPayload.sticker.pack || "ZapHub Bot",
                    author: msgPayload.sticker.author || "ZapHub",
                    type: "full",
                    quality: 50
                });
                msgPayload = { sticker: await sticker.toBuffer() };
            } catch (e: any) {
                throw new Error(`Failed to generate sticker from URL: ${e.message}`);
            }
        }

        if (msgPayload.image && typeof msgPayload.image === 'object' && msgPayload.image.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.image.url, { maxBytes: 25 * 1024 * 1024 });
                msgPayload.image = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch image from URL: ${e.message}`);
            }
        }

        if (msgPayload.video && typeof msgPayload.video === 'object' && msgPayload.video.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.video.url, { maxBytes: 100 * 1024 * 1024 });
                msgPayload.video = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch video from URL: ${e.message}`);
            }
        }

        if (msgPayload.document && typeof msgPayload.document === 'object' && msgPayload.document.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.document.url, { maxBytes: 100 * 1024 * 1024 });
                msgPayload.document = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch document from URL: ${e.message}`);
            }
        }

        if (msgPayload.audio && typeof msgPayload.audio === 'object' && msgPayload.audio.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.audio.url, { maxBytes: 50 * 1024 * 1024 });
                msgPayload.audio = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch audio from URL: ${e.message}`);
            }
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }
        return msgPayload;
    }

    static async sendTextMessage(sessionId: string, jid: string, messagePayload: any, mentions?: string[], quotedMessageId?: string) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw erroSemConexao();
        }

        // Handle quoted/reply message
        let quotedOption: any = undefined;
        if (quotedMessageId) {
            try {
                const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                if (dbSession) {
                    const quotedMsg = await prisma.message.findFirst({
                        where: { sessionId: dbSession.id, keyId: quotedMessageId },
                        select: { keyId: true, remoteJid: true, fromMe: true, content: true, senderJid: true }
                    });
                    if (quotedMsg) {
                        const rawParticipant = quotedMsg.fromMe 
                            ? instance.socket.user?.id 
                            : (quotedMsg.senderJid || quotedMsg.remoteJid);
                        
                        let cleanParticipant: string | undefined = undefined;
                        if (rawParticipant) {
                            const [userPart, domain] = rawParticipant.split('@');
                            const cleanUser = userPart.split(':')[0];
                            cleanParticipant = domain ? `${cleanUser}@${domain}` : cleanUser;
                        }

                        quotedOption = {
                            key: {
                                remoteJid: quotedMsg.remoteJid,
                                fromMe: quotedMsg.fromMe,
                                id: quotedMsg.keyId,
                                participant: cleanParticipant
                            },
                            message: {
                                conversation: quotedMsg.content || ""
                            }
                        };
                    }
                }
            } catch (e) {
                console.error("Error fetching quoted message (non-fatal):", e);
            }
        }

        const msgPayload = await ChatService.prepararConteudo(messagePayload, mentions);

        const options: any = { mentions: mentions || [] };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload, options);

        // Fire webhook for sent message (non-blocking)
        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: typeof msgPayload.text === 'string' ? msgPayload.text : (msgPayload.caption || "")
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media types to proper message structure for webhook
            if (msgPayload.image) {
                webhookMsg.message = {
                    imageMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "image/jpeg" }
                };
            } else if (msgPayload.video) {
                webhookMsg.message = {
                    videoMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "video/mp4" }
                };
            } else if (msgPayload.audio) {
                webhookMsg.message = {
                    audioMessage: { mimetype: msgPayload.ptt ? "audio/ogg; codecs=opus" : "audio/mp4" }
                };
            } else if (msgPayload.document) {
                webhookMsg.message = {
                    documentMessage: { caption: msgPayload.caption || "", fileName: msgPayload.fileName || "document", mimetype: msgPayload.mimetype || "application/octet-stream" }
                };
            } else if (msgPayload.sticker) {
                webhookMsg.message = {
                    stickerMessage: {}
                };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking — webhook failure shouldn't break message send
        }

        return sendResult;
    }

    /**
     * Send a media message locally from a buffer.
     */
    static async sendMediaMessage(
        sessionId: string,
        jid: string,
        buffer: Buffer,
        type: string,
        mimetype: string,
        fileName: string,
        caption: string,
        opts: { seconds?: number; encaminhada?: number } = {} // minha versao: duracao da voz; encaminhada = quantas vezes
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw erroSemConexao();
        }

        const messageOptions: any = {};
        if (caption) messageOptions.caption = caption;
        messageOptions.mimetype = mimetype;

        let content: any = {};

        if (type === 'image') {
            content = { image: buffer, ...messageOptions };
        } else if (type === 'video') {
            content = { video: buffer, ...messageOptions };
        } else if (type === 'audio') {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        } else if (type === 'voice') {
            // minha versao: mensagem de VOZ (microfone) -> converte para ogg/opus (o WhatsApp mostra como audio
            // de verdade, com ondinha e play). seconds ajuda a tela a mostrar a duracao antes do WhatsApp calcular.
            const { paraVozOpus } = await import("@/lib/audio-voz");
            const { buffer: ogg, seconds, waveform } = await paraVozOpus(buffer);
            const dur = opts.seconds || seconds;
            content = { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true, ...(dur ? { seconds: Math.max(1, Math.round(dur)) } : {}), ...(waveform ? { waveform } : {}) };
        } else if (type === 'voz-pronta') {
            // minha versao: voz que ja esta em ogg/opus (ex.: encaminhar uma mensagem de voz recebida)
            content = { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true };
        } else if (type === 'document') {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        } else if (type === 'sticker') {
            const sticker = new Sticker(buffer, {
                pack: "ZapHub Bot",
                author: "ZapHub",
                type: "full",
                quality: 50
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        }

        // minha versao: id gerado antes e arquivo guardado -> o store grava a midia com o proprio arquivo enviado,
        // sem baixar de volta do WhatsApp (antes a imagem enviada podia ficar sem aparecer ate o download terminar ou falhar)
        // minha versao: encaminhada -> quem recebe ve "Encaminhada" (4+ vezes: "com frequencia")
        if (opts.encaminhada) content.contextInfo = { isForwarded: true, forwardingScore: opts.encaminhada };
        const messageId = generateMessageIDV2(instance.socket.user?.id);
        const arquivo: Buffer | undefined = content.image || content.video || content.audio || content.document || content.sticker;
        if (Buffer.isBuffer(arquivo)) guardarMidiaEnviada(messageId, arquivo, content.mimetype);
        const sendResult = await instance.socket.sendMessage(jid, content, { messageId });

        // Fire webhook for sent media message (non-blocking)
        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: caption || ""
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media type to proper message structure for webhook
            if (type === 'image') {
                webhookMsg.message = { imageMessage: { caption: caption || "", mimetype } };
            } else if (type === 'video') {
                webhookMsg.message = { videoMessage: { caption: caption || "", mimetype } };
            } else if (type === 'audio' || type === 'voice') {
                webhookMsg.message = { audioMessage: { mimetype: type === 'voice' ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: type === 'voice' } };
            } else if (type === 'document') {
                webhookMsg.message = { documentMessage: { caption: caption || "", fileName, mimetype } };
            } else if (type === 'sticker') {
                webhookMsg.message = { stickerMessage: {} };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }

    /**
     * Send rich interactive message (Native Flow buttons, single_select list, etc.)
     */
    static async sendInteractiveMessage(
        sessionId: string,
        jid: string,
        payload: InteractiveMessagePayload,
        options: any = {}
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw erroSemConexao();
        }

        const sendResult = await instance.socket.sendMessage(jid, {
            interactiveMessage: payload
        } as any, options);

        // Fire webhook for sent interactive message
        try {
            const webhookMsg: any = {
                key: sendResult?.key || {},
                message: {
                    conversation: payload.body || payload.title || "Interactive Message"
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };
            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }

    /**
     * Send Album message with multiple images/videos
     */
    static async sendAlbumMessage(
        sessionId: string,
        jid: string,
        items: AlbumItem[],
        options: { caption?: string; quoted?: any } = {}
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw erroSemConexao();
        }

        const sendResult = await instance.socket.sendMessage(jid, {
            albumMessage: items
        } as any, options);

        try {
            const webhookMsg: any = {
                key: sendResult?.key || {},
                message: {
                    conversation: options.caption || "Album Message"
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };
            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }
}
