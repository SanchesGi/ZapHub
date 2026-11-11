// minha versao: jid <-> trecho da URL /dashboard/chat/<x>
// Contato comum vira so o numero; grupo/@lid/outros mantem o jid inteiro (antes virava "<id>@s.whatsapp.net" e quebrava).

export function urlDoJid(jid: string): string {
    if (jid.endsWith("@s.whatsapp.net")) return jid.split("@")[0];
    return encodeURIComponent(jid);
}

export function jidDaUrl(raw: string): string {
    let v = raw;
    try { v = decodeURIComponent(raw); } catch { /* ja decodificado */ }
    v = v.trim();
    if (v.includes("@")) return v.endsWith("@c.us") ? v.replace("@c.us", "@s.whatsapp.net") : v;
    let clean = v.replace(/\D/g, "");
    if (clean.startsWith("0")) clean = "55" + clean.substring(1); // Brasil (o original usava 62/Indonesia)
    return `${clean}@s.whatsapp.net`;
}

// evento usado pelo notificador para abrir uma conversa sem recarregar a pagina
export const EVENTO_ABRIR_CHAT = "wa-abrir-chat";
export type AbrirChatDetalhe = { sessionId: string; jid: string; name?: string; handled?: boolean };
