// minha versao: nome do arquivo ao baixar uma midia da conversa.
// - documento: o nome original (o WhatsApp manda em documentMessage.fileName; o store guarda em Message.content);
// - foto, video, audio e figurinha: o WhatsApp nao manda nome; usa tipo + data/hora da mensagem;
// - extensao: a do arquivo guardado (a real), nunca uma fixa.
// O nome e limpo: sem pastas, sem caracteres que o Windows recusa e sem controle; tamanho limitado.

type MsgDownload = { type: string; content?: string | null; mediaUrl?: string | null; timestamp?: string | number | Date | null; keyId?: string | null };

const TIPOS: Record<string, string> = { IMAGE: "foto", VIDEO: "video", AUDIO: "audio", STICKER: "figurinha", DOCUMENT: "documento" };

/** extensao do arquivo guardado (".pdf"), ou "" */
export function extensaoDaMidia(mediaUrl?: string | null): string {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec((mediaUrl || "").split(/[?#]/)[0]);
    return m ? `.${m[1].toLowerCase()}` : "";
}

/** tira pasta, caracteres proibidos no Windows/Linux e de controle; corta o tamanho mantendo a extensao */
export function limparNomeArquivo(nome: string, max = 150): string {
    let n = nome.split(/[\\/]/).pop() || "";
    n = Array.from(n).filter((c) => {
        const k = c.charCodeAt(0);
        const bidi = (k >= 0x202a && k <= 0x202e) || (k >= 0x2066 && k <= 0x2069) || k === 0x200e || k === 0x200f;
        return k >= 32 && k !== 127 && !bidi && !'<>:"|?*'.includes(c);
    }).join("");
    n = n.trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
    if (n.length > max) {
        const ext = extensaoDaMidia(n);
        n = n.slice(0, max - ext.length) + ext;
    }
    return n;
}

function dataHora(ts: MsgDownload["timestamp"]): string {
    const d = ts == null ? new Date(Number.NaN) : new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const p = (v: number) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function nomeParaDownload(msg: MsgDownload): string {
    const ext = extensaoDaMidia(msg.mediaUrl);
    if (msg.type === "DOCUMENT" && msg.content) {
        const original = limparNomeArquivo(msg.content);
        if (original) return extensaoDaMidia(original) ? original : original + ext;
    }
    const tipo = TIPOS[msg.type] || "arquivo";
    const quando = dataHora(msg.timestamp) || (msg.keyId || "").slice(-8);
    return `${tipo}${quando ? " " + quando : ""}${ext}`;
}
