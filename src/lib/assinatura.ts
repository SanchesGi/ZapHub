// minha versao: "Assinar" (o cliente ve *Seu Nome* em negrito em cima da mensagem), por sessao.
// - sessao privada: sempre desligada (so o dono usa; o servidor tambem ignora);
// - sessao compartilhada: ligada por padrao para todos (cada um pode desligar);
// - sessao nao compartilhada: desligada por padrao.
// A escolha de cada pessoa fica no navegador, separada para conversas privadas e grupos.

const CHAVE = "zaphub-assinatura";
type Prefs = Record<string, { privado?: boolean; grupo?: boolean }>;

export type SessaoParaAssinatura = { privada?: boolean | null; _count?: { sessionAccesses?: number } | null } | null | undefined;

export function assinaturaPadrao(s: SessaoParaAssinatura): boolean {
    return !!s && !s.privada && (s._count?.sessionAccesses || 0) > 0;
}

function ler(): Prefs {
    try {
        const v = JSON.parse(localStorage.getItem(CHAVE) || "{}");
        return v && typeof v === "object" ? v : {};
    } catch {
        return {};
    }
}

export function lerAssinatura(sessionId: string, grupo: boolean, s: SessaoParaAssinatura): boolean {
    if (!s || s.privada) return false;
    const v = ler()[sessionId]?.[grupo ? "grupo" : "privado"];
    return typeof v === "boolean" ? v : assinaturaPadrao(s);
}

export function salvarAssinatura(sessionId: string, grupo: boolean, ligada: boolean): void {
    try {
        const p = ler();
        p[sessionId] = { ...(p[sessionId] || {}), [grupo ? "grupo" : "privado"]: ligada };
        localStorage.setItem(CHAVE, JSON.stringify(p));
    } catch {
        /* navegador sem armazenamento: vale so ate recarregar */
    }
}
