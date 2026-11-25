// minha versao: regras puras da colecao de figurinhas de cada atendente (sem banco, sem disco, sem rede).
// O disco e o banco ficam em figurinhas.ts; aqui so ha o que da para testar sozinho (__tests__/figurinha-puro.test.ts).
import { createHash } from "node:crypto";

export const MAX_FIGURINHAS_POR_USUARIO = 300;
export const MAX_BYTES_FIGURINHA = 1024 * 1024; // 1 MB (o WhatsApp aceita ate 500 KB nas animadas e 100 KB nas estaticas; folga para o que vem de fora)
export const SUBPASTA_FIGURINHAS = "figurinhas";

const TAMANHO_MINIMO_WEBP = 20; // cabecalho RIFF (12) + um bloco (8)
const HASH_HEX = /^[0-9a-f]{64}$/;
const FLAG_ANIMACAO = 0x02; // bit de animacao no bloco VP8X do WebP

/** o arquivo e um WebP de verdade (RIFF....WEBP), nao so um nome terminado em .webp */
export function ehWebp(dados: Uint8Array): boolean {
    if (!dados || dados.length < TAMANHO_MINIMO_WEBP) return false;
    const texto = (de: number, ate: number) => String.fromCharCode(...dados.subarray(de, ate));
    return texto(0, 4) === "RIFF" && texto(8, 12) === "WEBP";
}

/** WebP animado: bloco VP8X com o bit de animacao ligado */
export function ehWebpAnimado(dados: Uint8Array): boolean {
    if (!ehWebp(dados) || dados.length < 21) return false;
    const bloco = String.fromCharCode(...dados.subarray(12, 16));
    return bloco === "VP8X" && (dados[20] & FLAG_ANIMACAO) !== 0;
}

export function hashDe(dados: Uint8Array): string {
    return createHash("sha256").update(dados).digest("hex");
}

export function hashValido(hash: unknown): hash is string {
    return typeof hash === "string" && HASH_HEX.test(hash);
}

/** "figurinhas/<sha256>.webp" (nome gravado no banco, relativo a pasta de midia); null se o hash nao for um sha256 */
export function nomeArquivoFigurinha(hash: string): string | null {
    return hashValido(hash) ? `${SUBPASTA_FIGURINHAS}/${hash}.webp` : null;
}

/** devolve o hash de um nome "figurinhas/<sha256>.webp" ou null (nunca aceita ".." nem outro formato) */
export function hashDoArquivo(arquivo: unknown): string | null {
    if (typeof arquivo !== "string") return null;
    const prefixo = `${SUBPASTA_FIGURINHAS}/`;
    if (!arquivo.startsWith(prefixo) || !arquivo.endsWith(".webp")) return null;
    const hash = arquivo.slice(prefixo.length, arquivo.length - ".webp".length);
    return hashValido(hash) ? hash : null;
}

export type ValidacaoFigurinha =
    | { ok: true; hash: string; animada: boolean; arquivo: string; bytes: number }
    | { ok: false; erro: string };

/** confere formato e tamanho; o limite de quantidade vale so para figurinha NOVA (`jaTem` = o usuario ja tem esse hash) */
export function validarFigurinha(
    dados: Uint8Array,
    totalDoUsuario: number,
    jaTemPorHash: (hash: string) => boolean = () => false,
): ValidacaoFigurinha {
    if (!dados || dados.length === 0) return { ok: false, erro: "Não encontrei o arquivo da figurinha." };
    if (dados.length > MAX_BYTES_FIGURINHA) return { ok: false, erro: "A figurinha passa de 1 MB." };
    if (!ehWebp(dados)) return { ok: false, erro: "Só dá para guardar figurinhas no formato WebP." };
    const hash = hashDe(dados);
    if (!jaTemPorHash(hash) && totalDoUsuario >= MAX_FIGURINHAS_POR_USUARIO) {
        return { ok: false, erro: `Você já tem ${MAX_FIGURINHAS_POR_USUARIO} figurinhas. Remova alguma para adicionar outra.` };
    }
    return { ok: true, hash, animada: ehWebpAnimado(dados), arquivo: nomeArquivoFigurinha(hash)!, bytes: dados.length };
}

type ParaOrdenar = { usadaEm?: Date | string | null; criadaEm: Date | string };

const instante = (v: Date | string | null | undefined): number => {
    if (!v) return 0;
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isFinite(t) ? t : 0;
};

/** as usadas por ultimo primeiro; as nunca usadas depois, da mais nova para a mais antiga */
export function ordenarFigurinhas<T extends ParaOrdenar>(lista: readonly T[]): T[] {
    return [...lista].sort((a, b) => {
        const ua = instante(a.usadaEm), ub = instante(b.usadaEm);
        if (ua !== ub) return ub - ua;
        return instante(b.criadaEm) - instante(a.criadaEm);
    });
}
