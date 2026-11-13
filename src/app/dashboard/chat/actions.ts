"use server";

import { prisma } from "@/lib/prisma";
import { ChatService, type ChatListFilter } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { marcarAgente } from "@/lib/agente";
import { waManager } from "@/modules/whatsapp/manager";
import { sincronizaEstadoChat } from "@/modules/whatsapp/store/estado-chat";
import { lidaAte } from "@/lib/leitura";
import { previaParaEnvio } from "@/lib/previa-link";
import { buscarSessao } from "@/lib/session-access";

const CHAT_PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "50", 10);

// minha versao: em producao o Next troca a mensagem de erro LANCADO numa Server Action pelo React #441.
// Erro esperado volta como dado; a tela usa exigirSucesso() para mostrar a mensagem real.
const falha = (error: string) => ({ success: false as const, error });

// Fetch chat list with cursor-based pagination & search
export async function getChatsStatus(
    sessionId: string,
    limit = CHAT_PAGE_SIZE,
    before?: string,
    search?: string,
    filter: ChatListFilter = "all"
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    return await ChatService.getChatsList(session.id, limit, before, search, filter);
}

// minha versao: encaminhar uma mensagem para ate 5 conversas (marca "Encaminhada", como no WhatsApp)
export async function encaminharMensagem(sessionId: string, keyId: string, destinos: string[]) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return falha("Forbidden");
    const alvos = [...new Set((Array.isArray(destinos) ? destinos : []).filter((j) => typeof j === "string" && /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(j)))];
    if (!alvos.length) return falha("Escolha pelo menos uma conversa");
    if (alvos.length > 5) return falha("No máximo 5 conversas por vez");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return falha("Session not found");
    try {
        const r = await ChatService.encaminhar(sessionId, session.id, keyId, alvos);
        for (const x of r) if (x.ok) marcarAgente(x.envio, user.name || user.email).catch(() => {});
        const falhas = r.filter((x) => !x.ok);
        return { success: true, enviados: r.length - falhas.length, falhas: falhas.map((x) => ({ jid: x.jid, erro: x.erro })) };
    } catch (error: any) {
        return falha(error?.message || "Falha ao encaminhar");
    }
}

// minha versao: busca da lista de conversas, alem das conversas: contatos sem conversa e mensagens com o texto
export async function buscarGeralChats(sessionId: string, termo: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) throw new Error("Session not found");
    return ChatService.buscarGeral(session.id, termo);
}

// Fetch messages for a specific chat with cursor pagination
export async function getChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const { messages, hasMore } = await ChatService.getMessages(session.id, jid, limit, before);
    const conferidas = await paraTela(messages);

    return {
        messages: conferidas.map((msg: any) => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : String(msg.timestamp)
        })),
        hasMore
    };
}

// Send a basic text message
export async function sendChatMessage(sessionId: string, jid: string, text: string, quotedMessageId?: string, mentions?: string[], assinar?: boolean) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return falha("Forbidden");

    try {
        // minha versao: "Assinar" -> o cliente tambem ve quem respondeu: "*Nome*" (negrito) e a mensagem na linha de baixo
        const nome = (user.name || user.email || "").trim();
        // sessao privada nao assina (so o dono usa; nao ha cliente para saber "quem respondeu")
        if (assinar && (await buscarSessao(sessionId, { privada: true }))?.privada) assinar = false;
        if (assinar && nome) text = `*${nome}*\n${text}`;
        // minha versao: previa do primeiro link (quem recebe tambem ve). No maximo 4 s; sem previa, envia assim mesmo
        const payload: any = { text };
        try {
            const p = await Promise.race([
                previaParaEnvio(text),
                new Promise<null>((ok) => setTimeout(() => ok(null), 4000)),
            ]);
            if (p) payload.linkPreview = p.linkPreview;
        } catch { /* previa nunca impede o envio */ }
        // repassa as @mencoes (o ChatService ja suportava) e marca o atendente que enviou
        const r = await ChatService.sendTextMessage(sessionId, jid, payload, mentions && mentions.length ? mentions : undefined, quotedMessageId);
        marcarAgente(r, user.name || user.email).catch(() => {});
        return { success: true };
    } catch (error: any) {
        return falha(`Não consegui enviar: ${error.message}`);
    }
}

// minha versao: reagir com emoji ("" remove a reacao)
export async function reagirMensagem(sessionId: string, keyId: string, emoji: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return falha("Forbidden");
    try {
        await ChatService.reagir(sessionId, keyId, emoji);
        return { success: true };
    } catch (error: any) {
        return falha(`Falha ao reagir: ${error.message}`);
    }
}

// minha versao: editar mensagem de texto enviada (regra em lib/editar-mensagem: propria, texto, ate 15 min).
// `jid` (opcional) amarra a mensagem a essa conversa (o programa do Windows manda; a tela do painel tambem).
export async function editarMensagem(sessionId: string, keyId: string, texto: string, jid?: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return falha("Forbidden");
    const { textoDeEdicao } = await import("@/lib/editar-mensagem");
    const t = textoDeEdicao(texto);
    if (!t.ok) return falha(t.erro);
    try {
        let jids: string[] | undefined;
        if (jid) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return falha("Session not found");
            jids = await ChatService.jidsDaConversa(session.id, jid);
        }
        await ChatService.editar(sessionId, keyId, t.texto, jids);
        return { success: true };
    } catch (error: any) {
        return falha(error?.message || "Falha ao editar a mensagem");
    }
}

// minha versao: conversa aberta no painel -> lida (zera o contador da lista) e manda o recibo de leitura
// ao WhatsApp para as recebidas ainda nao lidas (o celular tambem marca como lida).
export async function marcarConversaLida(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return { success: false };
    const agora = await lidaAte(session.id, jid); // minha versao: relogio do WhatsApp, nao o da VM (ver lib/leitura.ts)
    const anterior = await prisma.chatLeitura.findUnique({ where: { sessionId_jid: { sessionId: session.id, jid } } });
    await prisma.chatLeitura.upsert({
        where: { sessionId_jid: { sessionId: session.id, jid } },
        update: { lidoEm: agora, naoLida: false },
        create: { sessionId: session.id, jid, lidoEm: agora },
    });
    // minha versao: avisa TODOS os paineis abertos desta sessao (a bolinha some para os outros atendentes tambem)
    (global as any).io?.to(sessionId).emit("chat.lida", { sessionKey: sessionId, jid, por: user.name || user.email });

    try {
        const sock: any = waManager.getInstance(sessionId)?.socket;
        if (sock?.readMessages) {
            const pendentes = await prisma.message.findMany({
                where: {
                    sessionId: session.id, remoteJid: jid, fromMe: false,
                    status: { not: "READ" },
                    ...(anterior ? { timestamp: { gt: new Date(anterior.lidoEm.getTime() - 60_000) } } : {}),
                },
                orderBy: { timestamp: "desc" },
                take: 100,
                select: { id: true, keyId: true, senderJid: true },
            });
            if (pendentes.length) {
                const grupo = jid.endsWith("@g.us");
                await sock.readMessages(pendentes.map((m) => ({
                    remoteJid: jid, id: m.keyId, fromMe: false,
                    ...(grupo && m.senderJid ? { participant: m.senderJid } : {}),
                })));
                await prisma.message.updateMany({ where: { id: { in: pendentes.map((m) => m.id) } }, data: { status: "READ" } });
            }
        }
    } catch (e) {
        console.error("Recibo de leitura falhou (a conversa ficou lida no painel):", e);
    }
    return { success: true };
}

// minha versao: "marcar como nao lida" — aparece com a bolinha verde na lista ate alguem abrir a conversa.
// Tambem marca como nao lida no WhatsApp (o celular mostra a bolinha), se a sessao estiver conectada.
export async function marcarConversaNaoLida(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return { success: false };
    await prisma.chatLeitura.upsert({
        where: { sessionId_jid: { sessionId: session.id, jid } },
        update: { naoLida: true },
        create: { sessionId: session.id, jid, lidoEm: new Date(), naoLida: true },
    });
    (global as any).io?.to(sessionId).emit("chat.naoLida", { sessionKey: sessionId, jid });
    try {
        const sock: any = waManager.getInstance(sessionId)?.socket;
        const ultima = await prisma.message.findFirst({
            where: { sessionId: session.id, remoteJid: jid },
            orderBy: { timestamp: "desc" },
            select: { keyId: true, fromMe: true, senderJid: true, timestamp: true },
        });
        if (sincronizaEstadoChat() && sock?.chatModify && ultima) {
            await sock.chatModify({
                markRead: false,
                lastMessages: [{
                    key: { remoteJid: jid, id: ultima.keyId, fromMe: ultima.fromMe, ...(jid.endsWith("@g.us") && !ultima.fromMe && ultima.senderJid ? { participant: ultima.senderJid } : {}) },
                    messageTimestamp: Math.floor(ultima.timestamp.getTime() / 1000),
                }],
            }, jid);
        }
    } catch (e) {
        console.error("Marcar nao lida no WhatsApp falhou (ficou nao lida no painel):", e);
    }
    return { success: true };
}

// Upload and Send Media
export async function sendMediaMessage(formData: FormData) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");

    const sessionId = formData.get("sessionId") as string;
    const jid = formData.get("jid") as string;
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    const caption = formData.get("caption") as string || "";
    const dur = parseFloat((formData.get("duration") as string) || ""); // minha versao: duracao da voz (segundos)

    if (!sessionId || !jid || !file || !type) {
        return falha("Missing required fields");
    }

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return falha("Forbidden");

    try {
        const buffer = Buffer.from(await file.arrayBuffer());

        const r = await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption,
            Number.isFinite(dur) && dur > 0 ? { seconds: dur } : {}
        );
        marcarAgente(r, user.name || user.email).catch(() => {}); // minha versao: atendente

        return { success: true };
    } catch (error: any) {
        console.error("Media send error:", error);
        return falha(`Failed to send media: ${error.message}`);
    }
}

// Send Interactive Message (Native Flow buttons, single_select, CTA links, etc.)
export async function sendInteractiveChatMessage(
    sessionId: string,
    jid: string,
    payload: {
        title?: string;
        body: string;
        footer?: string;
        header?: any;
        buttons?: any[];
    }
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const result = await ChatService.sendInteractiveMessage(sessionId, jid, payload);
        return { success: true, result };
    } catch (error: any) {
        console.error("Interactive send error:", error);
        throw new Error(`Failed to send interactive message: ${error.message}`);
    }
}


// minha versao: estado da conversa aberta (mensagens fixadas + arquivada/silenciada/fixada)
export async function getEstadoConversa(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) throw new Error("Forbidden");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) throw new Error("Session not found");
    const { estadoParaTela, fixadasValidas } = await import("@/modules/whatsapp/store/estado-chat");
    const e = await prisma.chatEstado.findUnique({ where: { sessionId_jid: { sessionId: session.id, jid } } });
    const fixadas = fixadasValidas(e?.fixadas);
    const msgs = fixadas.length ? await prisma.message.findMany({
        where: { sessionId: session.id, keyId: { in: fixadas.map((f) => f.keyId) } },
        select: { keyId: true, content: true, type: true, fromMe: true, pushName: true, timestamp: true },
    }) : [];
    const porId = new Map(msgs.map((m) => [m.keyId, m]));
    return {
        ...estadoParaTela(e),
        fixadas: fixadas.map((f) => {
            const m = porId.get(f.keyId);
            return { ...f, content: m?.content ?? null, type: m?.type ?? null, fromMe: m?.fromMe ?? null, pushName: m?.pushName ?? null, timestamp: m?.timestamp ? m.timestamp.toISOString() : null };
        }),
    };
}

// minha versao: fixar/desafixar mensagem na conversa (vale para todos, como no WhatsApp). dias: 1, 7 ou 30.
export async function fixarMensagem(sessionId: string, keyId: string, fixar: boolean, dias: 1 | 7 | 30 = 7) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) return falha("Forbidden");
    const sock: any = waManager.getInstance(sessionId)?.socket;
    if (!sock) return falha("A sessão do WhatsApp está desconectada");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return falha("Session not found");
    const alvo = await prisma.message.findFirst({ where: { sessionId: session.id, keyId }, select: { keyId: true, remoteJid: true, fromMe: true, senderJid: true } });
    if (!alvo) return falha("Mensagem não encontrada");
    const isGroup = alvo.remoteJid.endsWith("@g.us");
    let participant: string | undefined;
    if (isGroup) {
        const raw = alvo.fromMe ? sock.user?.id : alvo.senderJid;
        if (raw) { const [u, d] = String(raw).split("@"); participant = d ? `${u.split(":")[0]}@${d}` : u; }
    }
    const segundos = ({ 1: 86400, 7: 604800, 30: 2592000 } as const)[dias] || 604800;
    // a propria mensagem de fixacao volta pelo messages.upsert e o store grava em ChatEstado.fixadas
    try {
        await sock.sendMessage(alvo.remoteJid, {
            pin: { remoteJid: alvo.remoteJid, fromMe: alvo.fromMe, id: alvo.keyId, ...(participant ? { participant } : {}) },
            type: fixar ? 1 : 2,
            ...(fixar ? { time: segundos } : {}),
        });
    } catch (error: any) {
        return falha(`Falha ao fixar: ${error?.message || error}`);
    }
    return { success: true };
}

// minha versao: midia que nao baixou -> "tentar de novo"
export async function tentarBaixarMidia(sessionId: string, keyId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) return falha("Forbidden");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return falha("Session not found");
    const { tentarMidiaDeNovo } = await import("@/lib/midia-fila");
    const ok = await tentarMidiaDeNovo(sessionId, session.id, keyId).catch(() => false);
    if (!ok) return falha("Não há como baixar esta mídia de novo (mensagem antiga, sem os dados de download).");
    return { success: true };
}

// minha versao: procurar mensagens DENTRO da conversa aberta (texto/legenda)
export async function buscarNaConversa(sessionId: string, jid: string, q: string, page = 1) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) throw new Error("Forbidden");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) throw new Error("Session not found");
    return await ChatService.buscarNaConversa(session.id, jid, q, 30, page);
}

// minha versao: carregar a janela de mensagens ao redor de uma (pular ate um resultado da busca)
export async function pularParaMensagem(sessionId: string, jid: string, keyId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) throw new Error("Forbidden");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) throw new Error("Session not found");
    const r: any = await ChatService.getMensagensAoRedor(session.id, jid, keyId, 25);
    return r?.messages ? { ...r, messages: await paraTela(r.messages) } : r;
}

/**
 * minha versao: prepara as mensagens para a tela. Midia cujo arquivo sumiu do disco aparece como indisponivel;
 * com os dados de download guardados, mostra "tentar de novo" (baixa de novo do WhatsApp enquanto ele tiver a midia).
 * Os dados de download nunca vao para o navegador (extraParaTela).
 */
async function paraTela(messages: any[]): Promise<any[]> {
    const { localizarMidia, nomeDoMediaUrl } = await import("@/lib/pasta-midia");
    const { extraParaTela } = await import("@/lib/midia-fila");
    return Promise.all(messages.map(async (msg: any) => {
        let m = msg;
        if (msg.mediaUrl) {
            const nome = nomeDoMediaUrl(msg.mediaUrl);
            if (nome && !(await localizarMidia(nome))) {
                const extra: any = { ...(msg.extra || {}) };
                if (extra.midiaOrigem && !extra.midiaPendente) extra.midiaPendente = { falhou: true };
                m = { ...msg, mediaUrl: null, extra };
            }
        }
        return { ...m, extra: extraParaTela(m.extra) };
    }));
}
