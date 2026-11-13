import { NextRequest, NextResponse } from "next/server";
import { acessoASessao, erroJson, jidDaUrl, respostaDeErro } from "@/lib/app-desktop";
import { fotoDaConversa } from "@/lib/app-conversa";
import { limitarTaxa } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Foto de perfil da conversa (bytes da imagem; 404 se nao tem ou a pessoa esconde). ?tamanho=grande para a versao maior.
// O servidor busca no WhatsApp (so em whatsapp.net): o cliente nunca recebe a URL do CDN.
// Limite: 120 pedidos por minuto por usuario (429).
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    try {
        const { userId, dbSessionId } = await acessoASessao(sessionId);
        const rl = limitarTaxa(`app-foto:${userId}`, 120, 60 * 1000);
        if (!rl.ok) return NextResponse.json({ ok: false, erro: "Muitos pedidos de foto. Tente de novo em instantes." }, { status: 429, headers: { "Retry-After": String(rl.emSegundos) } });
        const foto = await fotoDaConversa(sessionId, dbSessionId, jid, req.nextUrl.searchParams.get("tamanho") === "grande");
        if (!foto) return erroJson("Sem foto", 404);
        return new NextResponse(new Uint8Array(foto.bytes), {
            headers: {
                "Content-Type": foto.tipo,
                "Content-Length": String(foto.bytes.length),
                "Cache-Control": "private, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (e) {
        return respostaDeErro(e);
    }
}
