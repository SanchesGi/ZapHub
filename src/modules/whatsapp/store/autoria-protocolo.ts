// minha versao: quem pode editar/apagar uma mensagem salva. O alvo vem do conteudo do protocolo
// (protocolMessage.key.id), que e escolhido por quem enviou; entao so vale se o autor do pedido for o
// autor da mensagem alvo, no mesmo chat. Sem dependencias (teste puro).

/** tira o sufixo de aparelho (:47) e deixa o JID comparavel */
export function jidComparavel(jid: string | null | undefined): string {
    if (!jid) return "";
    return jid.replace(/:\d+(?=@)/, "").replace("@c.us", "@s.whatsapp.net");
}

function contem(lista: Array<string | null | undefined>, jid: string | null | undefined): boolean {
    const j = jidComparavel(jid);
    return !!j && lista.some((x) => jidComparavel(x) === j);
}

export type AlvoSalvo = { remoteJid: string; fromMe: boolean; senderJid: string | null };
/** `chat` e `remetente`: todas as formas conhecidas (telefone e lid) do chat e de quem enviou o pedido */
export type Pedido = { chat: Array<string | null | undefined>; remetente: Array<string | null | undefined>; fromMe: boolean; ehAdminDoGrupo?: boolean };

export function mesmoChat(alvoRemoteJid: string, chat: Pedido["chat"]): boolean {
    return contem(chat, alvoRemoteJid);
}

/**
 * - o alvo precisa estar no mesmo chat do pedido;
 * - mensagem minha: so um aparelho meu (fromMe) mexe nela;
 * - mensagem de outro: em conversa 1 a 1, o pedido vem do proprio contato; em grupo, de quem escreveu
 *   (a lista `remetente` tem o autor salvo);
 * - apagar para todos tambem vale para este numero (fromMe, ex.: admin pelo celular) e para admin de grupo.
 */
export function autorDoProtocolo(alvo: AlvoSalvo, pedido: Pedido, acao: "editar" | "apagar"): boolean {
    if (!mesmoChat(alvo.remoteJid, pedido.chat)) return false;
    if (alvo.fromMe) return pedido.fromMe || (acao === "apagar" && alvo.remoteJid.endsWith("@g.us") && !!pedido.ehAdminDoGrupo);
    if (pedido.fromMe) return acao === "apagar";
    if (!alvo.remoteJid.endsWith("@g.us")) return true; // 1 a 1, mesmo chat, e quem pediu nao sou eu: e o contato
    if (contem(pedido.remetente, alvo.senderJid)) return true;
    return acao === "apagar" && !!pedido.ehAdminDoGrupo;
}

/** admin do grupo, conforme os participantes salvos [{ id, admin }] */
export function ehAdmin(participantes: unknown, remetente: Array<string | null | undefined>): boolean {
    if (!Array.isArray(participantes)) return false;
    return participantes.some((p: any) => p && (p.admin === "admin" || p.admin === "superadmin") && contem(remetente, p.id));
}
