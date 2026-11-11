import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { verificarCodigo, lerProva } from "@/lib/dois-fatores";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { limitarTaxa } from "@/lib/rate-limit";

// minha versao: ativa (ou troca) o 2FA depois que o admin prova um codigo valido do segredo gerado no /setup.
// So aqui o segredo e gravado; ate la o fator que ja estava ativo continua valendo.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, email: true, twoFactorEnabled: true } });
  if (!user || user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente administradores" }, { status: 403 });

  const rl = limitarTaxa(`2fa-enable:${session.user.id}`, 10, 15 * 60_000);
  if (!rl.ok) return NextResponse.json({ status: false, message: `Muitas tentativas. Tente em ${rl.emSegundos}s.` }, { status: 429 });

  const { codigo, prova } = await req.json().catch(() => ({}));
  const segredo = lerProva(prova, session.user.id);
  if (!segredo) return NextResponse.json({ status: false, message: "Gere o QR primeiro (setup); o QR anterior venceu." }, { status: 400 });
  if (!verificarCodigo(String(codigo || ""), segredo)) {
    return NextResponse.json({ status: false, message: "Código inválido. Confira no app e tente de novo." }, { status: 400 });
  }
  await prisma.user.update({ where: { id: session.user.id }, data: { twoFactorSecret: segredo, twoFactorEnabled: true } });
  await registrarAcesso({ tipo: "2FA_ATIVADO", usuarioId: session.user.id, usuarioEmail: user.email, ip: ipDeHeaders(req.headers), detalhe: user.twoFactorEnabled ? "fator trocado" : null });
  return NextResponse.json({ status: true, message: "2FA ativado. A partir de agora o login pede o código." });
}
