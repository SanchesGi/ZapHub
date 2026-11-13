import { NextResponse } from "next/server";
import { codigoHttpDoErro } from "./app-desktop-puro";

// minha versao: rotas /api/app/* usadas pelo programa nativo do Windows. Elas chamam as mesmas funcoes da tela
// de conversas do painel (mesmas permissoes: login pelo cookie da sessao + canAccessSession), so trocam o
// formato da resposta para JSON com codigo HTTP.

const CODIGOS: Record<string, number> = { Unauthorized: 401, Forbidden: 403, "Session not found": 404 };

export function respostaDeErro(e: unknown): NextResponse {
    const msg = e instanceof Error ? e.message : String(e);
    const codigo = CODIGOS[msg];
    if (codigo) return NextResponse.json({ ok: false, erro: msg }, { status: codigo });
    console.error("API do app:", e);
    return NextResponse.json({ ok: false, erro: "Falha no servidor" }, { status: 500 });
}

// resultado { success:false, error } das funcoes da tela -> resposta HTTP
export function respostaDeResultado(r: { success: boolean; error?: string } & Record<string, unknown>): NextResponse {
    if (r.success) return NextResponse.json({ ok: true });
    // minha versao: "nao encontrada" vira 404 e "sessao desconectada" vira 503 (antes era sempre 400)
    return NextResponse.json({ ok: false, erro: r.error || "Falha" }, { status: codigoHttpDoErro(r.error || "") });
}

const JID = /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)$/;
export const jidValido = (jid: string) => JID.test(jid) && jid.length <= 120;

// data ISO usada como cursor de paginacao ("antes de")
export function cursorValido(v: string | null): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// minha versao: JID vindo da URL (decodifica e valida). null = invalido
export function jidDaUrl(bruto: string): string | null {
    let jid: string;
    try { jid = decodeURIComponent(bruto); } catch { return null; }
    return jidValido(jid) ? jid : null;
}

// minha versao: login (cookie da sessao) + canAccessSession + id interno da sessao. Lanca Unauthorized/Forbidden/Session not found.
export async function acessoASessao(sessionId: string): Promise<{ userId: string; dbSessionId: string }> {
    const { getAuthenticatedUserForAction } = await import("./server-action-auth");
    const { canAccessSession } = await import("./api-auth");
    const { prisma } = await import("./prisma");
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) throw new Error("Forbidden");
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!sessao) throw new Error("Session not found");
    return { userId: user.id, dbSessionId: sessao.id };
}

export const erroJson =(erro: string, status = 400) => NextResponse.json({ ok: false, erro }, { status });

// resposta de uma rota do painel (formato { status|success, message, error }) -> formato do programa { ok, erro }.
// Usada quando a rota do app chama a MESMA rota do painel (arquivar, silenciar, fixar, apagar), para herdar as regras dela.
export async function respostaDeRotaDoPainel(res: Response, extra: (corpo: any) => Record<string, unknown> = () => ({})): Promise<NextResponse> {
    const corpo: any = await res.json().catch(() => null);
    if (res.ok) return NextResponse.json({ ok: true, ...extra(corpo) });
    const msg = String(corpo?.message || corpo?.error || "Falha");
    const erro = /session not ready/i.test(msg) ? "A sessão do WhatsApp está desconectada" : msg;
    const status = res.status >= 400 && res.status < 600 ? res.status : 500;
    return NextResponse.json({ ok: false, erro }, { status });
}
