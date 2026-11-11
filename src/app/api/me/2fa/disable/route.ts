import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";

// desativa o 2FA — exige a senha atual (para ninguem desligar com a sessao aberta de outra pessoa)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, password: true } });
  if (!user || user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente administradores" }, { status: 403 });

  const { senha } = await req.json().catch(() => ({}));
  const ok = await bcrypt.compare(String(senha || ""), user.password);
  if (!ok) return NextResponse.json({ status: false, message: "Senha incorreta." }, { status: 400 });

  await prisma.user.update({ where: { id: session.user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  await registrarAcesso({ tipo: "2FA_DESATIVADO", usuarioId: session.user.id, usuarioEmail: session.user.email, ip: ipDeHeaders(req.headers) });
  return NextResponse.json({ status: true, message: "2FA desativado." });
}
