import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

// minha versao: sessoes que o usuario logado silenciou (vale so para ele, em qualquer computador).
// Silenciar e preferencia pessoal: nao muda nada para os colegas nem para a sessao no WhatsApp.
const MAX_SESSOES = 200;
const corpo = z.object({ ids: z.array(z.string().min(1).max(100)).max(MAX_SESSOES) });

function lista(valor: unknown): string[] {
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { sessoesSilenciadas: true } });
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ status: true, data: { ids: lista(user.sessoesSilenciadas) } });
}

export async function PUT(req: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const p = corpo.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ status: false, message: "Lista de sessões inválida" }, { status: 400 });
    const ids = [...new Set(p.data.ids)];
    await prisma.user.update({ where: { id: session.user.id }, data: { sessoesSilenciadas: ids } });
    return NextResponse.json({ status: true, data: { ids } });
}
