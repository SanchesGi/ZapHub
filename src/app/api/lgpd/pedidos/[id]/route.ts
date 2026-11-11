// minha versao: LGPD — atualiza um pedido de titular (status e resposta). So Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";

const STATUS = ["ABERTO", "CONCLUIDO", "RECUSADO"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const status = body?.status;
    if (typeof status !== "string" || !(STATUS as readonly string[]).includes(status)) {
        return NextResponse.json({ status: false, message: "Status inválido" }, { status: 400 });
    }
    let resposta: string | null | undefined = undefined;
    if (body?.resposta !== undefined) {
        if (body.resposta !== null && typeof body.resposta !== "string") return NextResponse.json({ status: false, message: "Resposta inválida" }, { status: 400 });
        resposta = body.resposta ? body.resposta.trim() : null;
        if (resposta && resposta.length > 5000) return NextResponse.json({ status: false, message: "Resposta longa demais (até 5000 caracteres)" }, { status: 400 });
    }

    const atual = await prisma.pedidoTitular.findUnique({ where: { id }, select: { id: true, titular: true, status: true } });
    if (!atual) return NextResponse.json({ status: false, message: "Pedido não encontrado" }, { status: 404 });

    const pedido = await prisma.pedidoTitular.update({
        where: { id },
        data: {
            status,
            ...(resposta !== undefined ? { resposta } : {}),
            concluidoEm: status === "ABERTO" ? null : (atual.status === "ABERTO" ? new Date() : undefined),
        },
    });
    await registrarAcesso({ tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: atual.titular, ip: ipDeHeaders(req.headers), detalhe: `pedido ${atual.status} -> ${status}` });
    return NextResponse.json({ status: true, message: "Pedido atualizado", data: pedido });
}
