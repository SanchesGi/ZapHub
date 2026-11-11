// minha versao: previa de link (titulo, descricao, site e miniatura), igual a que o WhatsApp mostra.
// - Mensagem RECEBIDA com previa: o WhatsApp ja manda os dados; o store guarda em Message.extra.previa.
// - Mensagem ENVIADA pelo painel: o servidor monta a previa aqui e manda junto (quem recebe tambem ve).
// - Mensagem sem previa: a tela pede GET /api/link-preview (este modulo, com cache).
// Seguranca: a pagina e a imagem sao buscadas por safeFetchBuffer (recusa IP interno e caminho local, limita
// tamanho e tempo); o HTML so e lido por expressoes limitadas, nunca executado; a miniatura sai como JPEG novo.
import { safeFetchBuffer } from "./security";

export type PreviaLink = {
    url: string;
    titulo: string | null;
    descricao: string | null;
    site: string | null;
    miniatura: string | null; // data:image/jpeg;base64,... (ate ~20 KB)
};

const MAX_HTML = 2 * 1024 * 1024;
const MAX_IMAGEM = 3 * 1024 * 1024;
const CACHE_MAX = 500;
const CACHE_OK_MS = 6 * 3_600_000;
const CACHE_FALHA_MS = 30 * 60_000;

type Entrada = { previa: PreviaLink | null; ate: number };
const G = globalThis as unknown as { __waPrevias?: Map<string, Entrada>; __waPreviasEmCurso?: Map<string, Promise<PreviaLink | null>> };
const cache = (G.__waPrevias ??= new Map());
const emCurso = (G.__waPreviasEmCurso ??= new Map());

// http(s)://... ou www.... ate um espaco; pontuacao final (.,;:!?) e parenteses soltos ficam de fora
const RE_LINK = /\b(?:https?:\/\/|www\.)[^\s<>"']{2,2000}/i;

/** primeiro link do texto, ja com https:// quando comeca com www., ou null */
export function primeiroLink(texto: string | null | undefined): string | null {
    if (!texto) return null;
    const m = RE_LINK.exec(texto.slice(0, 10_000));
    if (!m) return null;
    let url = m[0];
    while (/[.,;:!?)\]}*_~]$/.test(url)) {
        if (url.endsWith(")") && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
        url = url.slice(0, -1);
    }
    if (/^www\./i.test(url)) url = "https://" + url;
    try {
        const u = new URL(url);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        return u.toString();
    } catch {
        return null;
    }
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodificar(s: string): string {
    return s
        .replace(/&#(\d{1,7});/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
        .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => { const c = Number.parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
        .replace(/&([a-z]{2,6});/gi, (t, n) => ENTIDADES[n.toLowerCase()] ?? t)
        .replace(/\s+/g, " ")
        .trim();
}

/** le titulo, descricao, site e imagem do HTML (so o comeco da pagina, onde ficam as metas) */
export function lerMetas(html: string, base: string): Omit<PreviaLink, "miniatura" | "url"> & { imagem: string | null } {
    // as metas ficam no <head>; em paginas grandes (YouTube: ~1,4 MB, og:title perto do byte 790 mil) ele vai longe
    const fimHead = html.indexOf("</head>");
    const trecho = html.slice(0, fimHead > 0 ? Math.min(fimHead, 1_600_000) : 1_600_000);
    const metas = new Map<string, string>();
    for (const tag of trecho.match(/<meta\b[^>]{0,2000}>/gi) || []) {
        const attrs = new Map<string, string>();
        for (const a of tag.matchAll(/([a-zA-Z:_-]{1,40})\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/g)) {
            attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? "");
        }
        const chave = (attrs.get("property") || attrs.get("name") || "").toLowerCase();
        const valor = attrs.get("content");
        if (chave && valor && !metas.has(chave)) metas.set(chave, decodificar(valor));
    }
    const titulo = metas.get("og:title") || metas.get("twitter:title")
        || decodificar(/<title[^>]{0,200}>([^<]{1,500})<\/title>/i.exec(trecho)?.[1] || "") || null;
    const descricao = metas.get("og:description") || metas.get("twitter:description") || metas.get("description") || null;
    const site = metas.get("og:site_name") || null;
    let imagem = metas.get("og:image:secure_url") || metas.get("og:image") || metas.get("twitter:image") || null;
    if (imagem) {
        try { imagem = new URL(imagem, base).toString(); } catch { imagem = null; }
    }
    const cortar = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
    return { titulo: cortar(titulo, 200), descricao: cortar(descricao, 300), site: cortar(site, 80), imagem };
}

async function miniaturaDe(url: string): Promise<{ dataUri: string; jpeg: Buffer } | null> {
    try {
        const r = await safeFetchBuffer(url, { maxBytes: MAX_IMAGEM, timeoutMs: 6000 });
        if (!/^image\/(jpeg|png|webp|gif|avif)/i.test(r.contentType)) return null;
        const sharp = (await import("sharp")).default;
        const jpeg = await sharp(r.buffer, { limitInputPixels: 40_000_000, animated: false })
            .resize(192, 192, { fit: "cover" })
            .jpeg({ quality: 70 })
            .toBuffer();
        return { dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`, jpeg };
    } catch {
        return null;
    }
}

async function montar(url: string): Promise<{ previa: PreviaLink; jpeg: Buffer | null } | null> {
    let html: string;
    let final = url;
    try {
        const r = await safeFetchBuffer(url, { maxBytes: MAX_HTML, timeoutMs: 6000 });
        if (!/text\/html|application\/xhtml/i.test(r.contentType)) return null;
        html = r.buffer.toString("utf8");
    } catch {
        return null;
    }
    const m = lerMetas(html, final);
    if (!m.titulo && !m.descricao) return null;
    const mini = m.imagem ? await miniaturaDe(m.imagem) : null;
    let site = m.site;
    if (!site) { try { site = new URL(final).hostname.replace(/^www\./, ""); } catch { site = null; } }
    return { previa: { url: final, titulo: m.titulo, descricao: m.descricao, site, miniatura: mini?.dataUri || null }, jpeg: mini?.jpeg || null };
}

function guardar(url: string, previa: PreviaLink | null) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(url, { previa, ate: Date.now() + (previa ? CACHE_OK_MS : CACHE_FALHA_MS) });
}

/** previa de um link (com cache de 6 h; falha fica 30 min sem tentar de novo). Nunca lanca erro. */
export async function obterPrevia(url: string): Promise<PreviaLink | null> {
    const c = cache.get(url);
    if (c && Date.now() < c.ate) return c.previa;
    const andando = emCurso.get(url);
    if (andando) return andando;
    const p = (async () => {
        try {
            const r = await montar(url);
            guardar(url, r?.previa || null);
            return r?.previa || null;
        } catch {
            guardar(url, null);
            return null;
        } finally {
            emCurso.delete(url);
        }
    })();
    emCurso.set(url, p);
    return p;
}

/** dados para o Baileys mandar a previa junto com o texto (linkPreview do sendMessage) */
export async function previaParaEnvio(texto: string): Promise<{ previa: PreviaLink; linkPreview: any } | null> {
    const url = primeiroLink(texto);
    if (!url) return null;
    const previa = await obterPrevia(url);
    if (!previa) return null;
    const jpeg = previa.miniatura ? Buffer.from(previa.miniatura.split(",")[1] || "", "base64") : undefined;
    return {
        previa,
        linkPreview: {
            "canonical-url": previa.url,
            "matched-text": url,
            title: previa.titulo || "",
            description: previa.descricao || undefined,
            jpegThumbnail: jpeg && jpeg.length ? jpeg : undefined,
        },
    };
}

/** previa que veio do WhatsApp numa mensagem recebida (extendedTextMessage), ou null */
export function previaDoWhatsApp(ext: any): PreviaLink | null {
    if (!ext || typeof ext !== "object") return null;
    const titulo = typeof ext.title === "string" && ext.title.trim() ? ext.title.trim().slice(0, 200) : null;
    const descricao = typeof ext.description === "string" && ext.description.trim() ? ext.description.trim().slice(0, 300) : null;
    const url = typeof ext.canonicalUrl === "string" && ext.canonicalUrl ? ext.canonicalUrl : (typeof ext.matchedText === "string" ? ext.matchedText : null);
    if (!url || (!titulo && !descricao)) return null;
    // o cartao nao pode levar a outro site que nao o do link escrito no texto (golpe "o texto mostra banco.com")
    const host = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
    const escrito = primeiroLink(typeof ext.text === "string" ? ext.text : "") || (typeof ext.matchedText === "string" ? ext.matchedText : "");
    if (!escrito || host(url) !== host(escrito)) return null;
    let miniatura: string | null = null;
    const t = ext.jpegThumbnail;
    if (t && (t instanceof Uint8Array || Buffer.isBuffer(t)) && t.length > 0 && t.length <= 60_000) {
        miniatura = `data:image/jpeg;base64,${Buffer.from(t).toString("base64")}`;
    }
    let site: string | null = null;
    try { site = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { /* sem site */ }
    return { url: /^https?:/i.test(url) ? url : `https://${url}`, titulo, descricao, site, miniatura };
}
