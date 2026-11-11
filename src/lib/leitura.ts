import { prisma } from "@/lib/prisma";

// minha versao: "lida ate" de uma conversa = horario da mensagem MAIS NOVA dela (relogio do WhatsApp),
// e nao a hora da VM. A contagem de nao lidas compara com o horario das mensagens (que vem do WhatsApp);
// com o relogio da VM fora de hora, mensagens ja lidas voltavam como nao lidas (VM atrasada) ou mensagens
// novas eram contadas como lidas (VM adiantada). Assim vale nos dois casos.
export async function lidaAte(dbSessionId: string, jid: string): Promise<Date> {
    const ultima = await prisma.message.findFirst({
        where: { sessionId: dbSessionId, remoteJid: jid },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
    });
    return ultima?.timestamp ?? new Date();
}

// minha versao: quantas nao lidas uma conversa tem — MESMA regra da lista (ChatService.getChatsList):
// recebidas, ainda nao marcadas como lidas (painel, celular ou WhatsApp Web) e depois de
// max(ultima abertura no painel, minha ultima mensagem).
export async function contarNaoLidas(dbSessionId: string, jid: string): Promise<number> {
    const [leitura, minha] = await Promise.all([
        prisma.chatLeitura.findUnique({ where: { sessionId_jid: { sessionId: dbSessionId, jid } }, select: { lidoEm: true } }),
        prisma.message.findFirst({
            where: { sessionId: dbSessionId, remoteJid: jid, fromMe: true },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
        }),
    ]);
    const desde = [leitura?.lidoEm, minha?.timestamp].filter(Boolean).reduce<Date>(
        (a, b) => (b! > a ? b! : a), new Date(0));
    return prisma.message.count({
        where: { sessionId: dbSessionId, remoteJid: jid, fromMe: false, status: { not: "READ" }, timestamp: { gt: desde } },
    });
}

// minha versao: a conversa foi lida fora do painel (celular / WhatsApp Web). Se nao sobrou nenhuma
// nao lida, avisa os paineis abertos desta sessao para a bolinha sumir na hora.
export async function avisarSeFicouLida(io: any, sessionKey: string, dbSessionId: string, jid: string) {
    try {
        if ((await contarNaoLidas(dbSessionId, jid)) === 0) {
            io?.to(sessionKey).emit("chat.lida", { sessionKey, jid });
        }
    } catch { /* so o aviso ao vivo; a lista corrige no proximo recarregamento */ }
}
