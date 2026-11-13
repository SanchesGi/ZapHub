// minha versao: funcoes puras (sem banco, sem Next) das rotas /api/app/* do programa do Windows.
// Ficam separadas de app-desktop.ts para poderem ser testadas sozinhas.

// id da mensagem no WhatsApp: letras e numeros (o tamanho passa de 20 em alguns tipos de conta)
export const keyIdValido = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9]+$/.test(v);

// reacao: "" remove; senao EXATAMENTE um grafema (um emoji so, com tom de pele, bandeira, ZWJ ou chaveiro) que seja emoji
export function emojiValido(v: unknown): v is string {
    if (typeof v !== "string") return false;
    if (v === "") return true;
    if (v.length > 32) return false;
    const grafemas = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(v)];
    if (grafemas.length !== 1) return false;
    // so emoji e os "colas" das sequencias (variacao, ZWJ, chaveiro, bandeira, tom de pele, tags); nenhuma letra ou digito solto
    const SEM_RESTO = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\uFE0F|\u20E3|[\u{E0020}-\u{E007F}]|[0-9#*](?=\uFE0F?\u20E3))+$/u;
    return SEM_RESTO.test(v) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(v);
}

// "silenciar" do programa: sem `ate` = 8 horas (padrao do painel); "sempre" = -1; data ISO futura (ate 1 ano) = segundos ate la
export type DuracaoSilencio = { ok: true; segundos: number } | { ok: false; erro: string };
export function duracaoDeSilencio(ate: unknown, agora = Date.now()): DuracaoSilencio {
    if (ate === undefined || ate === null || ate === "") return { ok: true, segundos: 8 * 3600 };
    if (ate === "sempre") return { ok: true, segundos: -1 };
    if (typeof ate !== "string" || ate.length > 40) return { ok: false, erro: "Data inválida" };
    const quando = new Date(ate).getTime();
    if (Number.isNaN(quando)) return { ok: false, erro: "Data inválida" };
    const segundos = Math.round((quando - agora) / 1000);
    if (segundos < 60) return { ok: false, erro: "Escolha um horário no futuro" };
    if (segundos > 366 * 86400) return { ok: false, erro: "No máximo 1 ano" };
    return { ok: true, segundos };
}

// tipo real da imagem pelos primeiros bytes (nunca confia no Content-Type de fora)
export function tipoDeImagem(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    return null;
}

// so os digitos de um numero de telefone; 8 a 15 digitos (padrao E.164). null se nao serve
export function numeroValido(v: unknown): string | null {
    if (typeof v !== "string" || v.length > 40) return null;
    const d = v.replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? d : null;
}

// numero inteiro positivo de pagina (1 a max)
export function paginaValida(v: string | null, max = 1000): number {
    const n = Number.parseInt(v || "1", 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1;
}

// numero legivel de um JID de telefone ("5541999998888@s.whatsapp.net" -> "5541999998888"); outros formatos -> null
export function numeroDoJid(jid: string | null | undefined): string | null {
    const m = /^(\d{5,20})(?::\d+)?@s\.whatsapp\.net$/.exec(jid || "");
    return m ? m[1] : null;
}

// codigo HTTP de uma mensagem de erro das funcoes do painel (texto em portugues ou ingles)
export function codigoHttpDoErro(msg: string): number {
    if (msg === "Unauthorized") return 401;
    if (msg === "Forbidden") return 403;
    if (msg === "Session not found" || /não encontrad/i.test(msg)) return 404;
    if (/desconectad|disconnected|not ready|não está pronta/i.test(msg)) return 503;
    return 400;
}

// destinos de encaminhamento: a mesma regra da action encaminharMensagem do painel (sem broadcast nem newsletter)
export const DESTINO_ENCAMINHAR = /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/;
export const MAX_DESTINOS = 5;
export type Destinos = { ok: true; jids: string[] } | { ok: false; erro: string };
export function destinosDeEncaminhar(v: unknown): Destinos {
    if (!Array.isArray(v) || v.length === 0) return { ok: false, erro: "Escolha pelo menos uma conversa" };
    if (v.length > 50) return { ok: false, erro: "No máximo 5 conversas por vez" };
    if (!v.every((d) => typeof d === "string" && d.length <= 120 && DESTINO_ENCAMINHAR.test(d))) return { ok: false, erro: "Conversa de destino inválida" };
    const jids = [...new Set(v as string[])];
    if (jids.length > MAX_DESTINOS) return { ok: false, erro: "No máximo 5 conversas por vez" };
    return { ok: true, jids };
}

// jid de uma conversa que aceita mudar de estado (arquivar, silenciar, fixar, nao lida): so contato e grupo
export const jidDeConversa = (jid: string) => DESTINO_ENCAMINHAR.test(jid) && jid.length <= 120;

// CSRF das rotas /api/app/*: o cookie de sessao e Lax (bloqueia cross-site), mas same-site e texto puro passam.
// Pedido que muda coisa (nao GET/HEAD/OPTIONS) so passa se: Sec-Fetch-Site (quando vem) for same-origin/none E
// Origin (quando vem) for o endereco do proprio servidor. Sem nenhum dos dois (programa nativo sem cabecalho) passa.
// A comparacao ignora o esquema (http/https) para nao quebrar atras de proxy sem x-forwarded-proto; compara host e porta.
export function origemPermitida(p: { metodo: string; secFetchSite: string | null; origin: string | null; origemReal: string }): boolean {
    if (["GET", "HEAD", "OPTIONS"].includes(p.metodo.toUpperCase())) return true;
    if (p.secFetchSite && !["same-origin", "none"].includes(p.secFetchSite.toLowerCase())) return false;
    if (p.origin === null) return true;
    try {
        return new URL(p.origin).host.toLowerCase() === new URL(p.origemReal).host.toLowerCase();
    } catch {
        return false; // "null" ou lixo
    }
}

// teto do cache de fotos em bytes: tira as mais antigas ate caber
export function cabeNoCache(tamanhos: number[], novo: number, teto: number): number {
    // devolve quantas entradas (das mais antigas) precisam sair para caber "novo"
    let total = tamanhos.reduce((a, b) => a + b, 0) + novo;
    let sai = 0;
    while (total > teto && sai < tamanhos.length) total -= tamanhos[sai++];
    return sai;
}
