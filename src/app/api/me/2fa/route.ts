import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// status do 2FA do usuario logado (e se ele pode usar — so SUPERADMIN)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, twoFactorEnabled: true } });
  if (!user) return NextResponse.json({ status: false }, { status: 401 });
  return NextResponse.json({ status: true, data: { podeUsar: user.role === "SUPERADMIN", ativo: !!user.twoFactorEnabled } });
}
