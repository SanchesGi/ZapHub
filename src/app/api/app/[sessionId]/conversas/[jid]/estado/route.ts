import { NextRequest } from "next/server";
import { marcarConversaNaoLida } from "@/app/dashboard/chat/actions";
import { PUT as arquivarPeloPainel } from "@/app/api/chat/[sessionId]/[jid]/archive/route";
import { PUT as silenciarPeloPainel } from "@/app/api/chat/[sessionId]/[jid]/mute/route";
import { PUT as fixarPeloPainel } from "@/app/api/chat/[sessionId]/[jid]/pin/route";
import { duracaoDeSilencio, jidDeConversa } from "@/lib/app-desktop-puro";
import { acessoASessao, erroJson, jidDaUrl, respostaDeErro, respostaDeRotaDoPainel } from "@/lib/app-desktop";
import { conversaExiste } from "@/lib/app-conversa";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string; jid: string }> };
const ACOES = ["arquivar", "desarquivar", "silenciar", "dessilenciar", "fixar", "desfixar", "nao-lida"] as const;

// Estado da conversa: { acao, ate? }. Chama as MESMAS rotas do painel (arquivar, silenciar, fixar), que ja respeitam
// SINCRONIZAR_ESTADO_CHAT (sem a variavel, so o ZapHub guarda o estado e nada vai ao WhatsApp) e o limite de 3 fixadas.
// So contato (@s.whatsapp.net, @lid) e grupo (@g.us) que ja tenham mensagem nesta sessao (senao 404).
// `ate` so vale em "silenciar": data ISO futura (ate 1 ano) ou "sempre"; sem `ate` = 8 horas.
export async function POST(req: NextRequest, { params }: Params) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid || !jidDeConversa(jid)) return erroJson("Conversa inválida");
    const corpo = await req.json().catch(() => null);
    const acao = corpo?.acao;
    if (!ACOES.includes(acao)) return erroJson("Ação inválida");

    try {
        // a conversa precisa existir nesta sessao (ter mensagem); senao 404
        const { dbSessionId } = await acessoASessao(sessionId);
        if (!(await conversaExiste(dbSessionId, jid))) return erroJson("Conversa não encontrada", 404);
        if (acao === "nao-lida") {
            const r = await marcarConversaNaoLida(sessionId, jid);
            return r.success ? NextResponse.json({ ok: true }) : erroJson("Session not found", 404);
        }
        const rota = { sessionId, jid: encodeURIComponent(jid) };
        // pedido novo e sem cabecalhos do cliente: so o cookie da sessao vale
        const pedido = (dados: object) => new NextRequest(new URL(req.url), { method: "PUT", body: JSON.stringify(dados), headers: { "content-type": "application/json" } });
        let res: Response;
        if (acao === "arquivar" || acao === "desarquivar") {
            res = await arquivarPeloPainel(pedido({ archive: acao === "arquivar" }), { params: Promise.resolve(rota) });
        } else if (acao === "fixar" || acao === "desfixar") {
            res = await fixarPeloPainel(pedido({ pin: acao === "fixar" }), { params: Promise.resolve(rota) });
        } else if (acao === "silenciar") {
            const d = duracaoDeSilencio(corpo?.ate);
            if (!d.ok) return erroJson(d.erro);
            res = await silenciarPeloPainel(pedido({ mute: true, duration: d.segundos }), { params: Promise.resolve(rota) });
        } else {
            res = await silenciarPeloPainel(pedido({ mute: false }), { params: Promise.resolve(rota) });
        }
        return respostaDeRotaDoPainel(res);
    } catch (e) {
        return respostaDeErro(e);
    }
}
