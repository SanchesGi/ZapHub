// minha versao: quem pode abrir a Auditoria e quais sessoes cada um enxerga (usado pelas duas rotas da Auditoria).
// - So Supervisor e Super Administrador.
// - Cada um ve so as sessoes a que tem acesso (getAccessibleSessions): o Super Administrador, todas menos as
//   privadas de outros donos; o Supervisor, as dele e as compartilhadas com ele (nao as pessoais da equipe).
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin, podeGerenciarUsuarios, getAccessibleSessions } from "@/lib/api-auth";

export async function acessoDaAuditoria(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return { erro: NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 }) };
    if (!podeGerenciarUsuarios(user.role)) return { erro: NextResponse.json({ status: false, message: "Somente Supervisor ou Super Administrador" }, { status: 403 }) };
    const visiveis = await getAccessibleSessions(user.id, user.role);
    return { user, admin: isAdmin(user.role), visiveis, sessoesVisiveis: visiveis.map((s: any) => s.sessionId as string) };
}
