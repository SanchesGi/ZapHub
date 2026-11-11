// minha versao: o Baileys abre com createReadStream qualquer { url } que nao seja http(s) ou data:, e busca http(s)
// sem filtrar o endereco. Sem este filtro, um payload de mensagem podia ler arquivos do servidor (ex.: .env) ou
// acessar URLs internas. Roda em todo sock.sendMessage (ver instance.ts): toda URL de midia vira Buffer validado.

const CHAVES_MIDIA = new Set([
    "image", "video", "audio", "sticker", "document", "ptv", "gif", "media",
    "thumbnail", "jpegThumbnail", "productImage",
]);
const MAX_PROFUNDIDADE = 12;
const MAX_DOWNLOADS = 20;
const MAX_BYTES = 100 * 1024 * 1024; // mesmo teto de midia do ChatService

export type BuscarMidia = (url: string, maxBytes: number) => Promise<Buffer>;

const buscarPadrao: BuscarMidia = async (url, maxBytes) => {
    const { safeFetchBuffer } = await import("./security");
    return (await safeFetchBuffer(url, { maxBytes })).buffer;
};

// so objetos simples: instancias (Long, mensagens protobuf, Date) seguem intactas, porque copiar perderia os metodos
function ehObjeto(v: unknown): v is Record<string, any> {
    if (!v || typeof v !== "object") return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/** Devolve uma copia do conteudo sem nenhuma URL de midia crua. Lanca erro se houver origem nao permitida. */
export async function prepararMidiaSegura<T>(conteudo: T, buscar: BuscarMidia = buscarPadrao): Promise<T> {
    let downloads = 0;

    const baixar = async (url: string): Promise<Buffer> => {
        if (++downloads > MAX_DOWNLOADS) throw new Error("Mídias demais na mesma mensagem.");
        return buscar(url, MAX_BYTES);
    };

    const visitar = async (valor: any, chave: string | null, nivel: number): Promise<any> => {
        if (nivel > MAX_PROFUNDIDADE) throw new Error("Mensagem com aninhamento excessivo.");
        const emMidia = chave !== null && CHAVES_MIDIA.has(chave);

        // o reprodutor de cabecalho interativo recebe a miniatura como texto com a URL
        if (typeof valor === "string") {
            return chave === "thumbnail" && /^https?:/i.test(valor) ? baixar(valor) : valor;
        }
        if (Array.isArray(valor)) {
            return Promise.all(valor.map((v) => visitar(v, chave, nivel + 1)));
        }
        if (!ehObjeto(valor)) return valor;

        if (emMidia) {
            if ("stream" in valor) throw new Error("Origem de mídia não permitida.");
            if ("url" in valor) {
                const url = valor.url;
                if (typeof url !== "string") throw new Error("Origem de mídia não permitida.");
                if (!/^data:/i.test(url)) return baixar(url); // safeFetchBuffer recusa caminho local e IP interno
            }
        }

        const copia: Record<string, any> = {};
        for (const [k, v] of Object.entries(valor)) {
            if (k !== "__proto__") copia[k] = await visitar(v, k, nivel + 1);
        }
        return copia;
    };

    return visitar(conteudo, null, 0);
}
