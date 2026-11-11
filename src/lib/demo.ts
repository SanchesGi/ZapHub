// minha versao: MODO DEMONSTRACAO (ZAPHUB_DEMO=true). Para mostrar o ZapHub a quem quer conhecer:
// - nao conecta nenhum WhatsApp (as sessoes do banco aparecem como estao, com dados ficticios);
// - recusa alteracoes pela API e todo envio ao WhatsApp, com uma mensagem clara;
// - mostra uma faixa "demonstracao" no painel e o login de demonstracao na tela de entrada.
// O banco da demonstracao e preenchido por scripts/demo/popular-demo.ts e deve ser restaurado de tempos em tempos.

export const MODO_DEMO = process.env.ZAPHUB_DEMO === "true";

/** faixa no painel (pode ser desligada para tirar capturas de tela: ZAPHUB_DEMO_AVISO=false) */
export const AVISO_DEMO = MODO_DEMO && process.env.ZAPHUB_DEMO_AVISO !== "false";

export const MENSAGEM_DEMO = "Na demonstração nada é alterado nem enviado ao WhatsApp.";

// escrita pela API liberada na demonstracao: entrar/sair e aceitar os termos
const LIBERADAS = ["/api/auth/", "/api/me/termos"];

/** a requisicao altera algo e deve ser recusada no modo demonstracao? */
export function bloqueadaNaDemo(metodo: string, caminho: string, demo = MODO_DEMO): boolean {
    if (!demo) return false;
    if (["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) return false;
    if (!caminho.startsWith("/api/")) return false;
    return !LIBERADAS.some((p) => caminho === p.replace(/\/$/, "") || caminho.startsWith(p));
}
