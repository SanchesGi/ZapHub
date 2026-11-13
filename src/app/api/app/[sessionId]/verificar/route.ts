import { NextRequest, NextResponse } from "next/server";
import { limitarTaxa } from "@/lib/rate-limit";
import { waManager } from "@/modules/whatsapp/manager";
import { acessoASessao, erroJson, respostaDeErro } from "@/lib/app-desktop";
import { numeroValido } from "@/lib/app-desktop-puro";

export const dynamic = "force-dynamic";

const PRAZO_MS = 8000;

// O numero esta no WhatsApp? ?numero=5541999998888 (so digitos, com DDI; ignora espaco, +, parenteses e traco)
// Resposta: { ok, existe, jid }. Mesmo limite do painel (30 por minuto por usuario).
// Falha ou demora do WhatsApp (8 s) = 502; so responde existe:false quando o WhatsApp respondeu que o numero nao existe.
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const numero = numeroValido(req.nextUrl.searchParams.get("numero"));
    if (!numero) return erroJson("Número inválido");
    try {
        const { userId } = await acessoASessao(sessionId);
        const rl = limitarTaxa(`check:${userId}`, 30, 60 * 1000);
        if (!rl.ok) return NextResponse.json({ ok: false, erro: "Muitas consultas. Tente de novo em instantes." }, { status: 429, headers: { "Retry-After": String(rl.emSegundos) } });
        const sock = waManager.getInstance(sessionId)?.socket;
        if (!sock) return erroJson("A sessão do WhatsApp está desconectada", 503);
        let r: Awaited<ReturnType<typeof sock.onWhatsApp>>;
        try {
            r = await Promise.race([
                sock.onWhatsApp(numero),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error("prazo")), PRAZO_MS)),
            ]);
        } catch {
            return erroJson("O WhatsApp não respondeu. Tente de novo.", 502);
        }
        const achado = Array.isArray(r) && r.length ? r[0] : null;
        return NextResponse.json({ ok: true, existe: !!achado?.exists, jid: achado?.exists ? achado.jid : null });
    } catch (e) {
        return respostaDeErro(e);
    }
}
