// minha versao: Server Actions devolvem { success: false, error } em vez de lancar (ver chat/actions.ts).
// Isto volta a lancar no navegador, ja com a mensagem real, para o try/catch da tela funcionar como antes.
export function exigirSucesso<T>(r: T): T {
    const falha = r as { success?: boolean; error?: string } | null | undefined;
    if (falha?.success === false) throw new Error(falha.error || "Não consegui concluir a ação.");
    return r;
}
