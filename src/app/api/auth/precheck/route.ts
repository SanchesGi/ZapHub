import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { estaBloqueado, registrarFalhaPrecheck } from "@/lib/login-rate";
import { chaveDeBloqueio } from "@/lib/demo";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { limitarTaxa, ipDoRequest, resposta429 } from "@/lib/rate-limit";

// minha versao: login em 2 etapas. Diz APENAS se aquela conta precisa do codigo 2FA.
// Nao cria sessao, nao revela nada sem a senha certa: senha errada OU conta sem 2FA -> needs2fa=false
// (so retorna true quando a senha esta correta E a conta tem 2FA). Rate-limit por IP contra abuso.
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const rl = limitarTaxa(`precheck:${ipDoRequest(req)}`, 15, 60 * 1000); // 15/min por IP
  if (!rl.ok) return resposta429(rl.emSegundos);

  const body = await req.json().catch(() => ({}));
  const p = schema.safeParse(body);
  if (!p.success) return NextResponse.json({ needs2fa: false });

  const { email, password } = p.data;
  const ip = ipDeHeaders(req.headers);
  const chave = chaveDeBloqueio(email, ip);
  if (estaBloqueado(chave)) return NextResponse.json({ bloqueado: true, needs2fa: false });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true, twoFactorEnabled: true } });
  // minha versao: palpite errado aqui conta no MESMO bloqueio do login e entra no log de acesso
  if (!user) {
    registrarFalhaPrecheck(chave);
    await registrarAcesso({ tipo: "LOGIN_FALHA", usuarioEmail: email, ip, detalhe: "usuario inexistente (precheck)" });
    return NextResponse.json({ needs2fa: false }); // nao revela que o e-mail nao existe
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    registrarFalhaPrecheck(chave);
    await registrarAcesso({ tipo: "LOGIN_FALHA", usuarioId: user.id, usuarioEmail: email, ip, detalhe: "senha incorreta (precheck)" });
    return NextResponse.json({ needs2fa: false }); // senha errada: nao revela status de 2FA
  }

  return NextResponse.json({ needs2fa: !!user.twoFactorEnabled });
}
