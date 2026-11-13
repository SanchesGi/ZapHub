import { NextResponse } from "next/server";
import { encaminharMensagem } from "@/app/dashboard/chat/actions";
import { acessoASessao, erroJson, respostaDeErro, respostaDeResultado } from "@/lib/app-desktop";
import { destinosDeEncaminhar, keyIdValido } from "@/lib/app-desktop-puro";
import { limitarTaxa } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Encaminhar uma mensagem para ate 5 conversas: { keyId, destinos: [jid] }  (so @s.whatsapp.net, @g.us e @lid)
// Resposta: { ok, enviados, falhas: [{ jid, erro }] }. Se nenhum destino recebeu: HTTP 502 e ok:false (com as falhas).
// Limite: 20 pedidos por minuto por usuario (429).
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const corpo = await req.json().catch(() => null);
    if (!keyIdValido(corpo?.keyId)) return erroJson("Mensagem inválida");
    const destinos = destinosDeEncaminhar(corpo?.destinos);
    if (!destinos.ok) return erroJson(destinos.erro);
    try {
        const { userId } = await acessoASessao(sessionId);
        const rl = limitarTaxa(`app-encaminhar:${userId}`, 20, 60 * 1000);
        if (!rl.ok) return NextResponse.json({ ok: false, erro: "Muitos encaminhamentos. Tente de novo em instantes." }, { status: 429, headers: { "Retry-After": String(rl.emSegundos) } });
        const r = await encaminharMensagem(sessionId, corpo.keyId, destinos.jids);
        if (!r.success) return respostaDeResultado(r as { success: boolean; error?: string });
        const { enviados, falhas } = r as { enviados: number; falhas: { jid: string; erro?: string }[] };
        if (enviados === 0 && falhas.length) {
            return NextResponse.json({ ok: false, erro: falhas[0].erro || "Falha ao encaminhar", enviados, falhas }, { status: 502 });
        }
        return NextResponse.json({ ok: true, enviados, falhas });
    } catch (e) {
        return respostaDeErro(e);
    }
}
