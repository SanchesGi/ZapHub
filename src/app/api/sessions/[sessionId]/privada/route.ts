// minha versao: marcar uma sessao como PRIVADA (so o dono ve e usa; nem outro Super Administrador; nao pode ser
// compartilhada e a assinatura em negrito fica desligada). So o dono de verdade da sessao muda isso.
import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { buscarSessao } from "@/lib/session-access";
import { validarCorpo } from "@/lib/validar";
import { registrarAcesso } from "@/lib/log-acesso";
import { deixarSoODono } from "@/lib/revogar-socket";

const schema = z.object({ privada: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { sessionId } = await params;

    const s = await buscarSessao(sessionId, { id: true, sessionId: true, userId: true, name: true, privada: true });
    // quem nao e o dono recebe o mesmo 404 de uma sessao que nao existe (nao revela a sessao privada de outro)
    if (!s || s.userId !== user.id) return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });

    const v = await validarCorpo(request, schema);
    if (!v.ok) return v.resposta;
    const { privada } = v.data;

    if (privada) {
        // uma operacao so: so marca se nao houver ninguem com acesso (sem corrida com um compartilhamento ao mesmo tempo)
        const r = await prisma.session.updateMany({ where: { id: s.id, sessionAccesses: { none: {} } }, data: { privada: true } });
        if (r.count === 0) {
            return NextResponse.json({ status: false, message: "Esta sessão está compartilhada. Remova as pessoas com acesso antes de deixá-la privada." }, { status: 400 });
        }
        await deixarSoODono(s.userId, s.sessionId).catch(() => {});
    } else {
        await prisma.session.update({ where: { id: s.id }, data: { privada: false } });
    }
    await registrarAcesso({ tipo: "SESSAO_PRIVADA", usuarioId: user.id, usuarioEmail: user.email, alvo: s.name, detalhe: privada ? "marcada como privada" : "deixou de ser privada" });
    return NextResponse.json({ status: true, data: { privada } });
}
