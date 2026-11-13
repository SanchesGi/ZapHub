import { NextResponse } from "next/server";
import { marcarConversaLida } from "@/app/dashboard/chat/actions";
import { erroJson, jidDaUrl, respostaDeErro } from "@/lib/app-desktop";

export const dynamic = "force-dynamic";

// Conversa aberta no programa -> lida (mesma regra do painel: zera o contador e manda o recibo ao WhatsApp)
// Resposta: { ok:true }; sessao inexistente = 404.
export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    try {
        const r = await marcarConversaLida(sessionId, jid);
        return r.success ? NextResponse.json({ ok: true }) : erroJson("Session not found", 404);
    } catch (e) {
        return respostaDeErro(e);
    }
}
