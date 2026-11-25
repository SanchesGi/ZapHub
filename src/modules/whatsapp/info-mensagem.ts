// minha versao: dados do dialogo "Info da mensagem" (quem recebeu e quem leu, com horario).
// Servidor: junta os recibos gravados em Message.extra.recibos com o nome/telefone de cada participante.
import { prisma } from "@/lib/prisma";
import { batchResolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";
import { montarInfo, type Destinatario } from "@/lib/recibos";

export type PessoaInfo = { jid: string; nome: string | null; telefone: string | null; em: number | null };
export type InfoDaMensagem = {
    grupo: boolean;
    fromMe: boolean;
    status: string;
    enviadaEm: number;
    entregue: boolean;
    entregueEm: number | null;
    lida: boolean;
    lidaEm: number | null;
    entreguePara: PessoaInfo[];
    lidaPor: PessoaInfo[];
    /** membros do grupo (sem mim), quando conhecido */
    totalParticipantes: number | null;
};

/** telefone (so digitos) de um JID de telefone; @lid sem correspondencia = null (numero oculto) */
function telefoneDe(jid: string): string | null {
    if (isLidJid(jid) || !jid.endsWith("@s.whatsapp.net")) return null;
    const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
    return d || null;
}

async function pessoas(dbSessionId: string, lista: Destinatario[]): Promise<PessoaInfo[]> {
    if (!lista.length) return [];
    const mapa = await batchResolveToPhoneJid(lista.map((d) => d.jid), dbSessionId);
    const resolvidos = lista.map((d) => normalizeJid(mapa.get(d.jid) || d.jid));
    const contatos = await prisma.contact.findMany({
        where: { sessionId: dbSessionId, jid: { in: [...new Set(resolvidos)] } },
        select: { jid: true, name: true, notify: true },
    });
    const nomes = new Map(contatos.map((c) => [c.jid, c.name || c.notify || null]));
    return lista.map((d, i) => ({ jid: resolvidos[i], nome: nomes.get(resolvidos[i]) || null, telefone: telefoneDe(resolvidos[i]), em: d.em }));
}

/** null = mensagem nao encontrada nesta sessao */
export async function infoDaMensagem(dbSessionId: string, keyId: string): Promise<InfoDaMensagem | null> {
    const m = await prisma.message.findUnique({
        where: { sessionId_keyId: { sessionId: dbSessionId, keyId } },
        select: { fromMe: true, remoteJid: true, status: true, timestamp: true, extra: true },
    });
    if (!m) return null;
    const grupo = m.remoteJid.endsWith("@g.us");
    const info = montarInfo({
        status: m.status,
        enviadaEm: m.timestamp.getTime(),
        recibos: m.fromMe ? (m.extra as { recibos?: unknown } | null)?.recibos : null,
    });

    let totalParticipantes: number | null = null;
    if (grupo && m.fromMe) {
        const g = await prisma.group.findFirst({ where: { sessionId: dbSessionId, jid: m.remoteJid }, select: { participants: true } });
        if (Array.isArray(g?.participants)) totalParticipantes = Math.max(0, g.participants.length - 1);
    }

    const [entreguePara, lidaPor] = await Promise.all([pessoas(dbSessionId, info.entreguePara), pessoas(dbSessionId, info.lidaPor)]);
    return {
        grupo, fromMe: m.fromMe, status: m.status,
        enviadaEm: info.enviadaEm,
        entregue: info.entregue, entregueEm: info.entregueEm,
        lida: info.lida, lidaEm: info.lidaEm,
        entreguePara, lidaPor, totalParticipantes,
    };
}
