// minha versao: LGPD — verificacao comum das rotas /api/lgpd/* e /api/system/retencao*: so Super Administrador.
// Vale para chave de API tambem (quem tem a chave de um Super Administrador e o Super Administrador).
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "./api-auth";

export async function exigirSuperAdmin(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return { erro: NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 }) };
    if (user.role !== "SUPERADMIN") return { erro: NextResponse.json({ status: false, message: "Somente o Super Administrador" }, { status: 403 }) };
    return { user };
}

export function baixarJson(nome: string, dados: unknown) {
    return new NextResponse(JSON.stringify(dados, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${nome}"`,
            "Cache-Control": "no-store",
        },
    });
}
