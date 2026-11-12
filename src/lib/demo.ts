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

// fechadas na demonstracao ate para leitura: registros de acesso e do servidor (IP/e-mail de visitantes),
// manutencao (git fetch e du travam o servidor), espaco em disco e exportacao de dados
const FECHADAS = ["/api/logs-acesso", "/api/system/logs", "/api/system/manutencao", "/api/system/armazenamento", "/api/me/dados"];

export const DEMO_EMAIL = "demo@zaphub.demo";

/** a requisicao altera algo e deve ser recusada no modo demonstracao? */
export function bloqueadaNaDemo(metodo: string, caminho: string, demo = MODO_DEMO): boolean {
    if (!demo) return false;
    if (FECHADAS.some((p) => caminho === p || caminho.startsWith(p + "/"))) return true;
    if (["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) return false;
    if (!caminho.startsWith("/api/")) return false;
    return !LIBERADAS.some((p) => caminho === p.replace(/\/$/, "") || caminho.startsWith(p));
}

/**
 * chave do bloqueio de tentativas de login. Na demonstracao, a conta publica e bloqueada por IP: senao qualquer
 * visitante com 5 senhas erradas trancaria a demonstracao para todos.
 */
export function chaveDeBloqueio(email: string, ip: string | null | undefined, demo = MODO_DEMO): string {
    return demo && email.trim().toLowerCase() === DEMO_EMAIL ? `${email}|${ip || "?"}` : email;
}
