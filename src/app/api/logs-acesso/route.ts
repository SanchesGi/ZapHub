import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// lista a trilha de auditoria de acesso/admin. Apenas SUPERADMIN.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (me?.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente administradores" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo") || undefined;
  const busca = (searchParams.get("busca") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

  const where: any = {};
  if (tipo) where.tipo = tipo;
  if (busca) where.OR = [
    { usuarioEmail: { contains: busca } },
    { alvo: { contains: busca } },
    { ip: { contains: busca } },
    { detalhe: { contains: busca } },
  ];

  const [total, logs] = await Promise.all([
    prisma.logAcesso.count({ where }),
    prisma.logAcesso.findMany({ where, orderBy: { quando: "desc" }, skip: (page - 1) * limit, take: limit }),
  ]);

  return NextResponse.json({ status: true, data: logs, meta: { total, page, limit } });
}
