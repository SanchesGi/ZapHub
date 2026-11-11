// minha versao: registro de auditoria das mensagens apagadas.
// Guarda o conteudo original, de quem era a mensagem, em qual conversa, QUEM apagou e por onde
// (painel, o proprio contato no WhatsApp, ou este numero pelo celular).
import { prisma } from "@/lib/prisma";

type MensagemOriginal = {
    keyId: string;
    remoteJid: string;
    fromMe: boolean;
    senderJid?: string | null;
    pushName?: string | null;
    sentBy?: string | null;
    type?: string | null;
    content?: string | null;
    mediaUrl?: string | null;
    timestamp?: Date | null;
};

export type RegistroApagada = {
    sessionKey: string;        // Session.sessionId (texto)
    dbSessionId: string;       // Session.id (cuid)
    mensagem: MensagemOriginal;
    origem: "PAINEL" | "CONTATO" | "CELULAR";
    modo?: "TODOS" | "PARA_MIM";
    usuarioId?: string | null;
    usuarioNome?: string | null;
};

const telefone = (jid?: string | null) => (jid && jid.endsWith("@s.whatsapp.net") ? "+" + jid.split("@")[0] : null);

// nome salvo/notify do contato (resolve @lid pelo Contact.lid) ou nome do grupo
async function nomeDe(dbSessionId: string, jid?: string | null): Promise<string | null> {
    if (!jid) return null;
    if (jid.endsWith("@g.us")) {
        const g = await prisma.group.findFirst({ where: { sessionId: dbSessionId, jid }, select: { subject: true } });
        return g?.subject || null;
    }
    const c = await prisma.contact.findFirst({
        where: { sessionId: dbSessionId, OR: [{ jid }, { lid: jid }] },
        select: { name: true, notify: true },
    });
    return c?.name || c?.notify || null;
}

export async function registrarApagada(r: RegistroApagada) {
    try {
        const m = r.mensagem;
        const [chatNome, autorNomeContato] = await Promise.all([
            nomeDe(r.dbSessionId, m.remoteJid),
            m.fromMe ? Promise.resolve(null) : nomeDe(r.dbSessionId, m.senderJid || m.remoteJid),
        ]);
        const autorNome = m.fromMe
            ? (m.sentBy ? `Você · ${m.sentBy}` : "Você (este número)")
            : (autorNomeContato || m.pushName || telefone(m.senderJid || m.remoteJid) || "Contato");
        await prisma.auditoria.create({
            data: {
                sessionId: r.sessionKey,
                acao: "MENSAGEM_APAGADA",
                origem: r.origem,
                modo: r.modo || null,
                usuarioId: r.usuarioId || null,
                usuarioNome: r.usuarioNome || null,
                chatJid: m.remoteJid,
                chatNome: chatNome || telefone(m.remoteJid),
                keyId: m.keyId,
                autorJid: m.fromMe ? null : (m.senderJid || m.remoteJid),
                autorNome,
                fromMe: m.fromMe,
                tipo: m.type || null,
                conteudo: m.content || null,
                mediaUrl: m.mediaUrl || null,
                enviadaEm: m.timestamp || null,
            },
        });
    } catch (e) {
        console.error("Falha ao registrar auditoria de mensagem apagada:", e);
    }
}

export { nomeDe as nomeParaAuditoria };

// mensagens sendo apagadas PELO PAINEL: o eco do WhatsApp (protocolMessage) nao deve gerar um 2o registro.
// Em globalThis porque o servidor custom e o Next podem carregar copias diferentes do modulo.
const apagandoPainel: Set<string> = ((globalThis as any).__waApagandoPainel ??= new Set<string>());
export function marcarApagandoPeloPainel(keyId: string) {
    apagandoPainel.add(keyId);
    setTimeout(() => apagandoPainel.delete(keyId), 120_000);
}
export function apagandoPeloPainel(keyId: string) {
    return apagandoPainel.has(keyId);
}
