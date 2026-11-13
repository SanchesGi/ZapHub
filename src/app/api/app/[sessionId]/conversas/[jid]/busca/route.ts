import { NextRequest, NextResponse } from "next/server";
import { buscarNaConversa } from "@/app/dashboard/chat/actions";
import { erroJson, jidDaUrl, respostaDeErro } from "@/lib/app-desktop";
import { paginaValida } from "@/lib/app-desktop-puro";

export const dynamic = "force-dynamic";

// Procurar dentro da conversa (texto e legenda), mais recentes primeiro, 30 por pagina. ?q=<texto>&pagina=1
// Resposta: { ok, resultados: [{ keyId, content, fromMe, timestamp, type, senderName? }], total, paginas }
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!q) return erroJson("Digite o que procurar");
    if (q.length > 100) return erroJson("Busca grande demais");
    try {
        const r = await buscarNaConversa(sessionId, jid, q, paginaValida(req.nextUrl.searchParams.get("pagina")));
        return NextResponse.json({
            ok: true,
            resultados: r.resultados.map((m) => {
                const nome = ("senderName" in m && m.senderName) || ("pushName" in m && m.pushName) || null;
                return { keyId: m.keyId, content: m.content, fromMe: m.fromMe, timestamp: m.timestamp, type: m.type, ...(nome ? { senderName: nome } : {}) };
            }),
            total: r.total,
            paginas: r.paginas,
        });
    } catch (e) {
        return respostaDeErro(e);
    }
}
