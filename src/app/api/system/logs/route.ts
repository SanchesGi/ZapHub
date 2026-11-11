// minha versao: Manutencao > Logs. Ultimas linhas do servico ou da atualizacao, sem entrar na VM.
// So Super Administrador (os logs podem ter numeros e trechos de mensagens).
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { lerLogs } from "@/lib/manutencao";

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente o Super Administrador" }, { status: 403 });
    const fonte = req.nextUrl.searchParams.get("fonte") === "atualizacao" ? "atualizacao" : "servico";
    const n = Math.min(2000, Math.max(50, Number.parseInt(req.nextUrl.searchParams.get("n") || "400", 10) || 400));
    return NextResponse.json({ status: true, data: await lerLogs(fonte, n) });
}
