// minha versao: arquivos soltos em cima de um contato da LISTA. A lista guarda aqui e abre a conversa;
// a janela da conversa, ao abrir esse contato, pega os arquivos e mostra a previa de envio.
let pendente: { jid: string; arquivos: File[] } | null = null;

export const EVENTO_ARQUIVOS_PENDENTES = "wa-arquivos-pendentes";

export function deixarArquivos(jid: string, arquivos: File[]) {
    pendente = { jid, arquivos };
    try { window.dispatchEvent(new CustomEvent(EVENTO_ARQUIVOS_PENDENTES, { detail: { jid } })); } catch { /* ignora */ }
}

export function pegarArquivos(jid: string): File[] | null {
    if (!pendente || pendente.jid !== jid) return null;
    const a = pendente.arquivos;
    pendente = null;
    return a;
}

// arrastar so conta quando sao ARQUIVOS (nao texto/link arrastado dentro da pagina)
export function temArquivos(e: React.DragEvent | DragEvent): boolean {
    const tipos = (e as any).dataTransfer?.types;
    return !!tipos && Array.from(tipos as ArrayLike<string>).includes("Files");
}
