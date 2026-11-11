import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { validarSenhaForte } from "@/lib/senha";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import bcrypt from "bcryptjs";

// minha versao: qualquer usuario logado troca a PROPRIA senha. Confere a senha atual e exige senha forte.
export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const atual = String(body?.atual || "");
    const nova = String(body?.nova || "");

    const forte = validarSenhaForte(nova);
    if (!forte.ok) return NextResponse.json({ status: false, message: forte.motivo }, { status: 400 });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
    if (!dbUser) return NextResponse.json({ status: false, message: "Usuário não encontrado" }, { status: 404 });

    const confere = await bcrypt.compare(atual, dbUser.password);
    if (!confere) return NextResponse.json({ status: false, message: "A senha atual está incorreta" }, { status: 400 });

    if (await bcrypt.compare(nova, dbUser.password)) {
        return NextResponse.json({ status: false, message: "A nova senha precisa ser diferente da atual" }, { status: 400 });
    }

    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(nova, 10) } });
    await registrarAcesso({ tipo: "SENHA_TROCADA", usuarioId: user.id, usuarioEmail: user.email, ip: ipDeHeaders(req.headers) });
    return NextResponse.json({ status: true, message: "Senha alterada com sucesso" });
}
