// minha versao: LGPD — roda a limpeza por prazo agora. So Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { executarRetencao, retencaoRodando } from "@/lib/retencao";

export async function POST(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    if (retencaoRodando()) return NextResponse.json({ status: false, message: "A limpeza já está em andamento" }, { status: 409 });
    try {
        const resultado = await executarRetencao("MANUAL", { id: a.user!.id, email: a.user!.email });
        return NextResponse.json({ status: true, message: resultado.erro ? "A limpeza terminou com erro" : "Limpeza concluída", data: resultado });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Falha na limpeza" }, { status: 500 });
    }
}
