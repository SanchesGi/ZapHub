import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin, podeGerenciarUsuarios, ehDaMinhaEquipe } from "@/lib/api-auth";
import { validarSenhaForte } from "@/lib/senha";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { excluirUsuario } from "@/lib/excluir-conta";
import bcrypt from "bcryptjs";
import { desconectarUsuario } from "@/lib/revogar-socket";

// minha versao: Supervisor edita/remove so usuarios da Equipe (e pode trocar o proprio nome/senha);
// mudar papel (promover/rebaixar) e mexer em Supervisor/Super Administrador e so com Super Administrador.
async function alvoPermitido(quem: { id: string; role: string }, alvoId: string) {
    if (isAdmin(quem.role)) return { ok: true as const };
    if (alvoId === quem.id) return { ok: true as const };
    // Supervisor: so os membros da equipe DELE
    if (await ehDaMinhaEquipe(quem.id, quem.role, alvoId)) return { ok: true as const };
    return { ok: false as const, status: 403, msg: "Supervisor só gerencia os usuários da própria equipe" };
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    if (!user || !podeGerenciarUsuarios(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const pode = await alvoPermitido(user, id);
    if (!pode.ok) return NextResponse.json({ status: false, message: pode.msg, error: pode.msg }, { status: pode.status });

    try {
        const body = await request.json();
        const { name, email, password, role } = body;
        const supervisorIdNovo: string | null | undefined = body.supervisorId;

        // mudar papel: so Super Administrador (e ninguem tira o proprio acesso de administrador)
        if (role !== undefined && role !== null && role !== "") {
            if (!isAdmin(user.role)) {
                const atual = await prisma.user.findUnique({ where: { id }, select: { role: true } });
                if (atual?.role !== role) {
                    return NextResponse.json({ status: false, message: "Só o Super Administrador muda o papel de um usuário", error: "Forbidden" }, { status: 403 });
                }
            } else if (id === user.id && role !== "SUPERADMIN") {
                return NextResponse.json({ status: false, message: "Você não pode tirar o seu próprio acesso de Super Administrador", error: "Forbidden" }, { status: 400 });
            }
        }

        // minha versao: a PROPRIA senha so troca por /api/me/senha, que exige a senha atual (chave de API ou sessao
        // emprestada nao pode trocar a senha de quem esta usando)
        if (password && id === user.id) {
            return NextResponse.json({ status: false, message: "Para trocar a sua própria senha use \"Alterar senha\" (pede a senha atual).", error: "Bad Request" }, { status: 400 });
        }
        if (password) {
            const forte = validarSenhaForte(password);
            if (!forte.ok) return NextResponse.json({ status: false, message: forte.motivo, error: forte.motivo }, { status: 400 });
        }
        const updateData: any = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email;
        if (role && isAdmin(user.role)) updateData.role = role;
        // Supervisor responsavel: so o Super Administrador troca (precisa ser um Supervisor; vazio = sem equipe)
        if (isAdmin(user.role) && supervisorIdNovo !== undefined) {
            if (supervisorIdNovo) {
                const sup = await prisma.user.findUnique({ where: { id: supervisorIdNovo }, select: { role: true } });
                if (sup?.role !== "STAFF") return NextResponse.json({ status: false, message: "O responsável precisa ser um Supervisor", error: "Bad Request" }, { status: 400 });
            }
            updateData.supervisorId = supervisorIdNovo || null;
        }
        // deixou de ser Equipe -> sai da equipe do Supervisor
        if (updateData.role && updateData.role !== "USER") updateData.supervisorId = null;
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        // guarda o papel anterior para detectar troca de papel (auditoria)
        const antes = await prisma.user.findUnique({ where: { id }, select: { role: true, email: true } });

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                updatedAt: true
            }
        });

        // minha versao: senha ou e-mail de OUTRA pessoa mudados por quem administra: fica no registro de acesso e
        // a pessoa recebe um aviso no painel (assim ninguem entra na conta de outro, nem numa sessao privada, sem rastro)
        if (id !== user.id && (password || (email && antes && antes.email !== email))) {
            const ip = ipDeHeaders(request.headers);
            if (password) await registrarAcesso({ tipo: "SENHA_REDEFINIDA", usuarioId: user.id, usuarioEmail: user.email, alvo: antes?.email || id, ip });
            if (email && antes && antes.email !== email) await registrarAcesso({ tipo: "EMAIL_ALTERADO", usuarioId: user.id, usuarioEmail: user.email, alvo: antes.email, ip, detalhe: `-> ${email}` });
            await prisma.notification.create({
                data: {
                    userId: id,
                    title: password ? "Sua senha foi redefinida" : "Seu e-mail de acesso foi alterado",
                    message: `${user.name || user.email} ${password ? "redefiniu a sua senha" : "alterou o seu e-mail de acesso"}. Se você não pediu isso, fale com o responsável pelo sistema.`,
                    type: "SYSTEM",
                },
            }).catch(() => null);
        }

        if (updateData.role && antes && antes.role !== updateData.role) {
            await registrarAcesso({ tipo: "PAPEL_ALTERADO", usuarioId: user.id, usuarioEmail: user.email, alvo: antes.email, ip: ipDeHeaders(request.headers), detalhe: `${antes.role} -> ${updateData.role}` });
        }

        // minha versao: papel ou senha mudou -> derruba os sockets abertos dessa pessoa
        if (password || (updateData.role && antes && antes.role !== updateData.role)) {
            await desconectarUsuario(id).catch(() => {});
        }

        return NextResponse.json({ status: true, message: "User updated successfully", data: updatedUser });

    } catch (error) {
        console.error("Update user error:", error);
        return NextResponse.json({ status: false, message: "Failed to update user", error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    if (!user || !podeGerenciarUsuarios(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;

    if (id === user.id) {
        return NextResponse.json({ status: false, message: "Cannot delete yourself", error: "Cannot delete yourself" }, { status: 400 });
    }
    const pode = await alvoPermitido(user, id);
    if (!pode.ok) return NextResponse.json({ status: false, message: pode.msg, error: pode.msg }, { status: pode.status });

    try {
        // minha versao: a limpeza (sessoes do WhatsApp, credenciais, arquivos de midia, sockets) fica em lib/excluir-conta.ts
        const r = await excluirUsuario(id);
        await registrarAcesso({ tipo: "USUARIO_REMOVIDO", usuarioId: user.id, usuarioEmail: user.email, alvo: r.email, ip: ipDeHeaders(request.headers), detalhe: r.role ? `papel ${r.role}` : null });
        return NextResponse.json({ status: true, message: "User deleted successfully", sessoesRemovidas: r.sessoesRemovidas });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete user", error: "Failed to delete user" }, { status: 500 });
    }
}
