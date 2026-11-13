import { NextResponse } from "next/server";
import { acessoASessao, erroJson, jidDaUrl, respostaDeErro } from "@/lib/app-desktop";
import { infoDaConversa } from "@/lib/app-conversa";

export const dynamic = "force-dynamic";

// Dados da conversa: { ok, nome, numero, grupo, descricao?, participantes?: [{ jid, nome, admin }] }
// (descricao e participantes so em grupo; numero e null em grupo ou quando so se conhece o @lid)
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    try {
        const { dbSessionId } = await acessoASessao(sessionId);
        return NextResponse.json({ ok: true, ...(await infoDaConversa(sessionId, dbSessionId, jid)) });
    } catch (e) {
        return respostaDeErro(e);
    }
}
