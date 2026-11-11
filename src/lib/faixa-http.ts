// minha versao: le o cabecalho "Range: bytes=..." (pedido de um trecho do arquivo).
// Sem isso o navegador nao consegue pular para o meio de um video ou audio: ao mudar a posicao, voltava ao inicio.
// So aceita UMA faixa (o que os navegadores pedem para midia); varias faixas sao tratadas como arquivo inteiro.

export type Faixa = { inicio: number; fim: number };

/**
 * null = sem Range (ou formato que ignoramos): responder o arquivo inteiro (200).
 * "invalida" = faixa fora do arquivo: responder 416.
 */
export function lerFaixa(cabecalho: string | null | undefined, tamanho: number): Faixa | null | "invalida" {
    if (!cabecalho) return null;
    const m = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(cabecalho.trim());
    if (!m) return null;
    const [, a, b] = m;
    if (!a && !b) return null;
    if (tamanho <= 0) return "invalida";
    let inicio: number;
    let fim: number;
    if (!a) {
        // "bytes=-500" = os ultimos 500 bytes
        const ultimos = Number(b);
        if (ultimos <= 0) return "invalida";
        inicio = Math.max(0, tamanho - ultimos);
        fim = tamanho - 1;
    } else {
        inicio = Number(a);
        fim = b ? Math.min(Number(b), tamanho - 1) : tamanho - 1;
    }
    if (inicio >= tamanho || inicio > fim) return "invalida";
    return { inicio, fim };
}
