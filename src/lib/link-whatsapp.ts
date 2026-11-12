// minha versao: le os links "clique para conversar" do WhatsApp para abrir a conversa no ZapHub:
//   https://api.whatsapp.com/send/?phone=5543999998888&text=Ola
//   https://wa.me/5543999998888?text=Ola
//   https://web.whatsapp.com/send?phone=5543999998888&text=Ola
//   whatsapp://send?phone=5543999998888&text=Ola   (o que a pagina do api.whatsapp.com aciona no computador)
// Convite de grupo (chat.whatsapp.com) e link curto de empresa (wa.me/message/...) nao tem numero: nao sao lidos.

export type LinkWhatsApp = { numero: string | null; texto: string };

const HOSTS = new Set(["wa.me", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com", "www.whatsapp.com"]);
const MAX_TEXTO = 4096;

/** tira os caracteres `c` do comeco e do fim (sem expressao regular: tempo linear com qualquer texto) */
export function aparar(v: string, c: string, inicio = true, fim = true): string {
    let i = 0;
    let j = v.length;
    if (inicio) while (i < j && v[i] === c) i++;
    if (fim) while (j > i && v[j - 1] === c) j--;
    return v.slice(i, j);
}

function soDigitos(v: string | null | undefined): string | null {
    const d = (v || "").replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? d : null;
}

function textoDe(v: string | null | undefined): string {
    return (v || "").slice(0, MAX_TEXTO);
}

/** devolve numero (so digitos, com DDI) e texto do link; null se nao for um link de conversa do WhatsApp */
export function lerLinkWhatsApp(entrada: string | null | undefined): LinkWhatsApp | null {
    const bruto = (entrada || "").trim();
    if (!bruto || bruto.length > 8192) return null;
    let u: URL;
    try {
        u = new URL(bruto);
    } catch {
        return null;
    }

    if (u.protocol === "whatsapp:") {
        // whatsapp://send?phone=...&text=...  (a "rota" fica no host ou no caminho, conforme o navegador)
        const rota = aparar(u.host || u.pathname, "/");
        if (rota !== "send") return null;
        return { numero: soDigitos(u.searchParams.get("phone")), texto: textoDe(u.searchParams.get("text")) };
    }

    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (!HOSTS.has(host)) return null;
    const caminho = aparar(u.pathname, "/", false, true);

    if (host === "wa.me") {
        if (caminho.startsWith("/message/") || caminho.startsWith("/qr/")) return null; // link curto de empresa: sem numero
        const numero = soDigitos(caminho.slice(1));
        const texto = textoDe(u.searchParams.get("text"));
        if (!numero && !texto) return null;
        return { numero, texto };
    }

    if (caminho === "/send" || caminho === "") {
        const numero = soDigitos(u.searchParams.get("phone"));
        const texto = textoDe(u.searchParams.get("text"));
        if (caminho === "" && !numero) return null; // a pagina inicial do WhatsApp nao e um link de conversa
        return { numero, texto };
    }
    return null;
}

/** endereco do painel que abre o link no ZapHub */
export function enderecoParaAbrir(link: string): string {
    return `/dashboard/abrir?url=${encodeURIComponent(link)}`;
}

// ---- texto do link para o campo da conversa ----
// A pagina /dashboard/abrir guarda o texto no navegador (sessionStorage) so depois do clique em "Abrir conversa";
// a conversa le uma vez e apaga. Assim um link externo direto para o chat nao preenche nada.
const CHAVE_TEXTO = "zaphub-texto-do-link";
const VALIDADE_MS = 2 * 60_000;

export function guardarTextoDoLink(jid: string, texto: string): void {
    try {
        sessionStorage.setItem(CHAVE_TEXTO, JSON.stringify({ jid, texto: texto.slice(0, MAX_TEXTO), em: Date.now() }));
    } catch { /* sem armazenamento: so nao preenche */ }
}

export function pegarTextoDoLink(jid: string): string | null {
    try {
        const v = JSON.parse(sessionStorage.getItem(CHAVE_TEXTO) || "null");
        if (!v || v.jid !== jid) return null;
        sessionStorage.removeItem(CHAVE_TEXTO);
        return Date.now() - Number(v.em) < VALIDADE_MS && typeof v.texto === "string" ? v.texto : null;
    } catch {
        return null;
    }
}
