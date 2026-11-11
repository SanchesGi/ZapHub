// minha versao: LGPD — pedidos de titulares (contatos do WhatsApp). So Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";

const TIPOS_PEDIDO = ["ACESSO", "CORRECAO", "EXCLUSAO", "OPOSICAO", "OUTRO"] as const;
const STATUS = ["ABERTO", "CONCLUIDO", "RECUSADO"] as const;

export async function GET(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const status = req.nextUrl.searchParams.get("status");
    if (status && !(STATUS as readonly string[]).includes(status)) {
        return NextResponse.json({ status: false, message: "Status inválido" }, { status: 400 });
    }
    const pedidos = await prisma.pedidoTitular.findMany({
        where: status ? { status } : undefined,
        orderBy: { criadoEm: "desc" },
        take: 500,
    });
    return NextResponse.json({ status: true, data: pedidos });
}

export async function POST(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));

    const titular = typeof body?.titular === "string" ? body.titular.trim() : "";
    const tipo = typeof body?.tipo === "string" ? body.tipo : "";
    const descricao = typeof body?.descricao === "string" ? body.descricao.trim() : "";
    const nome = typeof body?.nome === "string" && body.nome.trim() ? body.nome.trim() : null;
    const sessionId = typeof body?.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;

    if (!titular || titular.length > 100) return NextResponse.json({ status: false, message: "Informe o titular (telefone ou jid, até 100 caracteres)" }, { status: 400 });
    if (!(TIPOS_PEDIDO as readonly string[]).includes(tipo)) return NextResponse.json({ status: false, message: "Tipo de pedido inválido" }, { status: 400 });
    if (!descricao || descricao.length > 5000) return NextResponse.json({ status: false, message: "Descreva o pedido (até 5000 caracteres)" }, { status: 400 });
    if (nome && nome.length > 200) return NextResponse.json({ status: false, message: "Nome longo demais" }, { status: 400 });
    if (sessionId && sessionId.length > 100) return NextResponse.json({ status: false, message: "Sessão inválida" }, { status: 400 });

    // telefone vira so digitos; jid fica como veio
    const digitos = titular.replace(/\D/g, "");
    const titularGravado = titular.includes("@") ? titular : digitos;
    if (!titularGravado) return NextResponse.json({ status: false, message: "Titular inválido" }, { status: 400 });

    const pedido = await prisma.pedidoTitular.create({
        data: { titular: titularGravado, nome, tipo, descricao, sessionId, criadoPorId: a.user!.id },
    });
    await registrarAcesso({ tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: titularGravado, ip: ipDeHeaders(req.headers), detalhe: `pedido ${tipo} registrado` });
    return NextResponse.json({ status: true, message: "Pedido registrado", data: pedido }, { status: 201 });
}
