import { NextRequest, NextResponse } from "next/server";
import { getChatsStatus } from "@/app/dashboard/chat/actions";
import { cursorValido, respostaDeErro } from "@/lib/app-desktop";
import type { ChatListFilter } from "@/modules/whatsapp/chat.service";

export const dynamic = "force-dynamic";

const FILTROS: ChatListFilter[] = ["all", "private", "groups", "archived"];

// Lista de conversas da sessao (programa do Windows). ?antes=<ISO>&busca=<texto>&filtro=all|private|groups|archived
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const q = req.nextUrl.searchParams;
    const filtro = FILTROS.includes(q.get("filtro") as ChatListFilter) ? (q.get("filtro") as ChatListFilter) : "all";
    const busca = (q.get("busca") || "").slice(0, 100) || undefined;
    try {
        const conversas = await getChatsStatus(sessionId, 50, cursorValido(q.get("antes")), busca, filtro);
        // minha versao: a URL da foto do CDN do WhatsApp nao vai para o programa (ele usa .../conversas/{jid}/foto)
        return NextResponse.json({ ok: true, conversas: conversas.map(({ profilePic, ...resto }) => (void profilePic, resto)) });
    } catch (e) {
        return respostaDeErro(e);
    }
}
