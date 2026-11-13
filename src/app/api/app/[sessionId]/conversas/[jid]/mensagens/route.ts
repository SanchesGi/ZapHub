import { NextRequest, NextResponse } from "next/server";
import { getChatMessages, sendChatMessage } from "@/app/dashboard/chat/actions";
import { cursorValido, jidDaUrl, respostaDeErro, respostaDeResultado } from "@/lib/app-desktop";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string; jid: string }> };

// Mensagens da conversa, da mais antiga para a mais nova. ?antes=<ISO> pagina para tras (50 por vez)
export async function GET(req: NextRequest, { params }: Params) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return NextResponse.json({ ok: false, erro: "Conversa inválida" }, { status: 400 });
    try {
        const r = await getChatMessages(sessionId, jid, 50, cursorValido(req.nextUrl.searchParams.get("antes")));
        return NextResponse.json({ ok: true, mensagens: r.messages, temMais: r.hasMore });
    } catch (e) {
        return respostaDeErro(e);
    }
}

// Envia texto: { texto, citada?: keyId, assinar?: boolean }
export async function POST(req: NextRequest, { params }: Params) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return NextResponse.json({ ok: false, erro: "Conversa inválida" }, { status: 400 });
    const corpo = await req.json().catch(() => null);
    const texto = typeof corpo?.texto === "string" ? corpo.texto : "";
    if (!texto.trim()) return NextResponse.json({ ok: false, erro: "Mensagem vazia" }, { status: 400 });
    if (texto.length > 65536) return NextResponse.json({ ok: false, erro: "Mensagem grande demais" }, { status: 400 });
    const citada = typeof corpo?.citada === "string" && corpo.citada.length <= 128 ? corpo.citada : undefined;
    try {
        return respostaDeResultado(await sendChatMessage(sessionId, jid, texto, citada, undefined, corpo?.assinar === true));
    } catch (e) {
        return respostaDeErro(e);
    }
}
