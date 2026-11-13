import { NextRequest } from "next/server";
import { DELETE as apagarPeloPainel } from "@/app/api/messages/[sessionId]/[jid]/[messageId]/route";
import { editarMensagem } from "@/app/dashboard/chat/actions";
import { acessoASessao, erroJson, jidDaUrl, respostaDeErro, respostaDeResultado, respostaDeRotaDoPainel } from "@/lib/app-desktop";
import { keyIdValido } from "@/lib/app-desktop-puro";
import { mensagemDaConversa } from "@/lib/app-conversa";

export const dynamic = "force-dynamic";

// Apagar mensagem: chama a MESMA rota do painel (login pelo cookie + canAccessSession, auditoria de quem apagou,
// "para todos" quando e minha ou sou admin do grupo; mensagem de outra pessoa so some para mim).
// A mensagem precisa existir nesta conversa (404 "Mensagem não encontrada").
// Resposta: { ok, modo: "TODOS" | "PARA_MIM", aviso }
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string; keyId: string }> }) {
    const { sessionId, jid: bruto, keyId } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    if (!keyIdValido(keyId)) return erroJson("Mensagem inválida");
    try {
        const { dbSessionId } = await acessoASessao(sessionId);
        if (!(await mensagemDaConversa(dbSessionId, jid, keyId))) return erroJson("Mensagem não encontrada", 404);
    } catch (e) {
        return respostaDeErro(e);
    }
    // pedido novo, sem cabecalhos do cliente: so o cookie da sessao vale (o painel le o login pelo contexto da requisicao)
    const pedido = new NextRequest(new URL(req.url), { method: "DELETE" });
    const res = await apagarPeloPainel(pedido, { params: Promise.resolve({ sessionId, jid: encodeURIComponent(jid), messageId: keyId }) });
    return respostaDeRotaDoPainel(res, (c) => ({ modo: c?.modo, aviso: c?.message }));
}

// Editar mensagem de texto enviada: { texto } -> { ok:true }. So mensagem propria desta conversa, de texto e com ate
// 15 minutos (regra do WhatsApp). Erros: 400 com o motivo, 404 "Mensagem não encontrada", 503 sessao desconectada.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string; keyId: string }> }) {
    const { sessionId, jid: bruto, keyId } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return erroJson("Conversa inválida");
    if (!keyIdValido(keyId)) return erroJson("Mensagem inválida");
    const corpo = await req.json().catch(() => null);
    try {
        return respostaDeResultado(await editarMensagem(sessionId, keyId, typeof corpo?.texto === "string" ? corpo.texto : "", jid));
    } catch (e) {
        return respostaDeErro(e);
    }
}
