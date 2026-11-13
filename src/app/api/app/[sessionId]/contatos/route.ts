import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession } from "@/lib/api-auth";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { respostaDeErro } from "@/lib/app-desktop";
import { numeroDoJid, paginaValida } from "@/lib/app-desktop-puro";

export const dynamic = "force-dynamic";

const POR_PAGINA = 30;

// Contatos da agenda (com telefone e algum nome), para "nova conversa". ?busca=<nome ou numero>&pagina=1
// Resposta: { ok, contatos: [{ jid, nome, numero, temConversa }], temMais }
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const q = req.nextUrl.searchParams;
    const busca = (q.get("busca") || "").trim().slice(0, 100);
    const pagina = paginaValida(q.get("pagina"));
    try {
        const user = await getAuthenticatedUserForAction();
        if (!user) throw new Error("Unauthorized");
        if (!(await canAccessSession(user.id, user.role, sessionId))) throw new Error("Forbidden");
        const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!sessao) throw new Error("Session not found");

        const numeros = ChatService.variantesNumero(busca);
        const ehTexto = /\p{L}/u.test(busca);
        const filtros: object[] = [{ jid: { endsWith: "@s.whatsapp.net" } }, { OR: [{ name: { not: null } }, { notify: { not: null } }] }];
        if (busca) {
            filtros.push({
                OR: [
                    ...(ehTexto || !numeros.length ? [{ name: { contains: busca } }, { notify: { contains: busca } }, { verifiedName: { contains: busca } }] : []),
                    ...numeros.map((n) => ({ jid: { contains: n } })),
                ],
            });
        }
        const linhas = await prisma.contact.findMany({
            where: { sessionId: sessao.id, AND: filtros },
            select: { jid: true, name: true, notify: true, verifiedName: true },
            orderBy: [{ name: "asc" }, { notify: "asc" }, { jid: "asc" }],
            skip: (pagina - 1) * POR_PAGINA,
            take: POR_PAGINA + 1,
        });
        const temMais = linhas.length > POR_PAGINA;
        const pagina30 = linhas.slice(0, POR_PAGINA);
        const comConversa = pagina30.length
            ? new Set((await prisma.message.groupBy({
                by: ["remoteJid"],
                where: { sessionId: sessao.id, remoteJid: { in: pagina30.map((c) => c.jid) } },
            })).map((m) => m.remoteJid))
            : new Set<string>();
        const contatos = pagina30.map((c) => ({
            jid: c.jid,
            nome: c.name || c.notify || c.verifiedName || numeroDoJid(c.jid) || c.jid,
            numero: numeroDoJid(c.jid),
            temConversa: comConversa.has(c.jid),
        }));
        return NextResponse.json({ ok: true, contatos, temMais });
    } catch (e) {
        return respostaDeErro(e);
    }
}

