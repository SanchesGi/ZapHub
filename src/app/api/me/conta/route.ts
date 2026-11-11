// minha versao: LGPD — o usuario apaga a PROPRIA conta. Pede a senha e a palavra EXCLUIR.
// Mesma limpeza do DELETE /api/users/[id] (lib/excluir-conta.ts). Recusa o ultimo Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { excluirUsuario } from "@/lib/excluir-conta";
import { limitarTaxa, resposta429 } from "@/lib/rate-limit";

export async function DELETE(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    // apagar a propria conta e ato da pessoa, no painel: chave de API nao serve
    if (user.authMethod !== "session") {
        return NextResponse.json({ status: false, message: "A exclusão da conta precisa ser feita pelo painel" }, { status: 403 });
    }

    const rl = limitarTaxa(`excluir-conta:${user.id}`, 5, 10 * 60 * 1000);
    if (!rl.ok) return resposta429(rl.emSegundos);

    const body = await req.json().catch(() => ({}));
    if (body?.confirmacao !== "EXCLUIR") {
        return NextResponse.json({ status: false, error: "confirmacao_invalida", message: "Digite EXCLUIR para confirmar" }, { status: 400 });
    }
    const senha = typeof body?.senha === "string" ? body.senha.slice(0, 200) : "";
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true, role: true } });
    if (!dbUser) return NextResponse.json({ status: false, message: "Usuário não encontrado" }, { status: 404 });
    if (!senha || !(await bcrypt.compare(senha, dbUser.password))) {
        return NextResponse.json({ status: false, error: "senha_incorreta", message: "Senha incorreta" }, { status: 400 });
    }

    if (dbUser.role === "SUPERADMIN") {
        const admins = await prisma.user.count({ where: { role: "SUPERADMIN" } });
        if (admins <= 1) {
            return NextResponse.json({ status: false, error: "ultimo_admin", message: "Você é o único Super Administrador. Promova outra pessoa antes de excluir a conta." }, { status: 400 });
        }
    }

    try {
        const r = await excluirUsuario(user.id);
        const ip = ipDeHeaders(req.headers);
        await registrarAcesso({ tipo: "USUARIO_REMOVIDO", usuarioId: user.id, usuarioEmail: user.email, alvo: user.email, ip, detalhe: "exclusao da propria conta" });
        await registrarAcesso({ tipo: "CONTA_EXCLUIDA", usuarioEmail: user.email, alvo: user.email, ip, detalhe: `${r.sessoesRemovidas} sessão(ões) e ${r.arquivosRemovidos} arquivo(s) de mídia removidos` });
        return NextResponse.json({ status: true, message: "Conta excluída", data: { sessoesRemovidas: r.sessoesRemovidas, arquivosRemovidos: r.arquivosRemovidos } });
    } catch (error) {
        console.error("Delete own account error:", error);
        return NextResponse.json({ status: false, message: "Não foi possível excluir a conta" }, { status: 500 });
    }
}
