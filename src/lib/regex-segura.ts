// minha versao: expressao regular de resposta automatica vem do usuario e roda no processo que atende TODAS as
// sessoes; um padrao como (a+)+$ trava o servidor inteiro com uma unica mensagem. Nao da para dar tempo limite a uma
// regex em JS, entao: padrao curto, sem retrovisor, sem grupo repetido que contenha repeticao ou alternativa, e
// o texto testado tem tamanho limitado. E uma barreira conservadora: pode recusar padroes inofensivos.
export const MAX_PADRAO = 100;
export const MAX_TEXTO = 1000;

const QUANTIFICADORES = new Set(["+", "*", "{"]);

export function padraoSeguro(padrao: string): boolean {
    if (typeof padrao !== "string" || !padrao || padrao.length > MAX_PADRAO) return false;
    try { new RegExp(padrao, "i"); } catch { return false; }

    // cada nivel de grupo anota se tem repeticao ou alternativa dentro
    const pilha: boolean[] = [false];
    let emClasse = false;
    for (let i = 0; i < padrao.length; i++) {
        const c = padrao[i];
        if (c === "\\") {
            const prox = padrao[i + 1] ?? "";
            if (/[1-9]/.test(prox) || prox === "k") return false; // retrovisor
            i++;
            continue;
        }
        if (emClasse) { if (c === "]") emClasse = false; continue; }
        if (c === "[") { emClasse = true; continue; }
        if (c === "(") { pilha.push(false); continue; }
        if (c === ")") {
            const tinha = pilha.pop() ?? false;
            const seguinte = padrao[i + 1] ?? "";
            const repetido = QUANTIFICADORES.has(seguinte);
            if (repetido && tinha) return false;
            if (pilha.length === 0) pilha.push(false);
            if (tinha || repetido) pilha[pilha.length - 1] = true;
            continue;
        }
        if (QUANTIFICADORES.has(c) || c === "|") pilha[pilha.length - 1] = true;
    }
    return true;
}

/** testa o texto (cortado em MAX_TEXTO) contra o padrao; padrao inseguro ou invalido nunca casa */
export function testarRegexSegura(padrao: string, texto: string): boolean {
    if (!padraoSeguro(padrao)) return false;
    return new RegExp(padrao, "i").test(String(texto).slice(0, MAX_TEXTO));
}
