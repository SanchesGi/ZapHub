import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { normalizarTom } from "@/lib/emojis";
import { esquemaPreferencias } from "@/lib/preferencias-usuario";

// minha versao: preferencias do usuario logado (vale so para ele, em qualquer computador). Por enquanto: tomDePele (0..5).
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { tomDePele: true } });
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ status: true, data: { tomDePele: normalizarTom(user.tomDePele) } });
}

export async function PUT(req: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const p = esquemaPreferencias.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ status: false, message: "Preferência inválida" }, { status: 400 });
    const tomDePele = normalizarTom(p.data.tomDePele);
    await prisma.user.update({ where: { id: session.user.id }, data: { tomDePele } });
    return NextResponse.json({ status: true, data: { tomDePele } });
}
