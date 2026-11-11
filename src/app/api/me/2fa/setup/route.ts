import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { gerarSegredo, urlOtpauth, qrDataUrl, verificarCodigoUnico, criarProva } from "@/lib/dois-fatores";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { limitarTaxa } from "@/lib/rate-limit";

// minha versao: gera um segredo NOVO e o QR, sem gravar nada no usuario. Exige a senha atual e, se o 2FA ja estiver
// ligado, tambem o codigo atual. O segredo novo so entra em vigor no /enable, depois de provar o codigo dele.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, email: true, password: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user || user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente administradores" }, { status: 403 });

  const rl = limitarTaxa(`2fa-setup:${session.user.id}`, 10, 15 * 60_000);
  if (!rl.ok) return NextResponse.json({ status: false, message: `Muitas tentativas. Tente em ${rl.emSegundos}s.` }, { status: 429 });

  const { senha, codigoAtual } = await req.json().catch(() => ({}));
  const ip = ipDeHeaders(req.headers);
  if (!(await bcrypt.compare(String(senha || ""), user.password))) {
    await registrarAcesso({ tipo: "2FA_SETUP_FALHA", usuarioId: session.user.id, usuarioEmail: user.email, ip, detalhe: "senha incorreta" });
    return NextResponse.json({ status: false, message: "Senha incorreta." }, { status: 400 });
  }
  if (user.twoFactorEnabled && user.twoFactorSecret && !verificarCodigoUnico(session.user.id, String(codigoAtual || ""), user.twoFactorSecret)) {
    await registrarAcesso({ tipo: "2FA_SETUP_FALHA", usuarioId: session.user.id, usuarioEmail: user.email, ip, detalhe: "codigo atual incorreto" });
    return NextResponse.json({ status: false, message: "Informe o código atual do app autenticador." }, { status: 400 });
  }

  const segredo = gerarSegredo();
  const qr = await qrDataUrl(urlOtpauth(user.email, segredo));
  // segredo texto vai junto para quem nao conseguir escanear o QR; "prova" volta no /enable
  return NextResponse.json({ status: true, data: { qr, segredo, prova: criarProva(session.user.id, segredo) } });
}
