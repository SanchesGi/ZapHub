import { reagirMensagem } from "@/app/dashboard/chat/actions";
import { acessoASessao, erroJson, jidDaUrl, respostaDeErro, respostaDeResultado } from "@/lib/app-desktop";
import { emojiValido, keyIdValido } from "@/lib/app-desktop-puro";
import { mensagemDaConversa } from "@/lib/app-conversa";

export const dynamic = "force-dynamic";

// Reagir a uma mensagem: { emoji: "👍" } ("" remove a reacao). Um emoji so. Usa a mesma funcao do painel (reagirMensagem).
// A mensagem precisa existir nesta conversa (404 "Mensagem não encontrada").
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string; jid: string; keyId: string }> }) {
    const { sessionId, jid: bruto, keyId } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    if (!keyIdValido(keyId)) return erroJson("Mensagem inválida");
    const corpo = await req.json().catch(() => null);
    if (!emojiValido(corpo?.emoji)) return erroJson("Emoji inválido");
    try {
        const { dbSessionId } = await acessoASessao(sessionId);
        if (!(await mensagemDaConversa(dbSessionId, jid, keyId))) return erroJson("Mensagem não encontrada", 404);
        return respostaDeResultado(await reagirMensagem(sessionId, keyId, corpo.emoji));
    } catch (e) {
        return respostaDeErro(e);
    }
}
