import { NextRequest, NextResponse } from "next/server";
import { sendMediaMessage } from "@/app/dashboard/chat/actions";
import { jidDaUrl, respostaDeErro, respostaDeResultado } from "@/lib/app-desktop";

export const dynamic = "force-dynamic";

const TIPOS = new Set(["image", "video", "audio", "voice", "document"]);

// Envia midia (multipart): arquivo, tipo (image|video|audio|voice|document), legenda?, duracao? (voz, segundos).
// A conversao (voz para OGG/Opus etc.) e as checagens sao as mesmas do painel (ChatService/midia-segura).
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    const { sessionId, jid: bruto } = await params;
    const jid = jidDaUrl(bruto);
    if (!jid) return NextResponse.json({ ok: false, erro: "Conversa inválida" }, { status: 400 });
    const form = await req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    const tipo = String(form?.get("tipo") || "");
    if (!(arquivo instanceof File) || !TIPOS.has(tipo)) {
        return NextResponse.json({ ok: false, erro: "Arquivo ou tipo inválido" }, { status: 400 });
    }
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("jid", jid);
    fd.set("file", arquivo);
    fd.set("type", tipo);
    fd.set("caption", String(form?.get("legenda") || "").slice(0, 4096));
    const duracao = String(form?.get("duracao") || "");
    if (duracao) fd.set("duration", duracao);
    try {
        return respostaDeResultado(await sendMediaMessage(fd));
    } catch (e) {
        return respostaDeErro(e);
    }
}
