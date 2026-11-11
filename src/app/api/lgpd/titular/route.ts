// minha versao: LGPD — resumo do que o sistema guarda sobre um titular (contato do WhatsApp), em todas as sessoes.
import { NextRequest, NextResponse } from "next/server";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { resumoDoTitular } from "@/lib/titular";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { normalizarTelefone } from "@/lib/lgpd-puro";

export async function GET(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const telefone = req.nextUrl.searchParams.get("telefone") || "";
    const resumo = await resumoDoTitular(telefone);
    if (!resumo) return NextResponse.json({ status: false, message: "Informe um telefone válido (8 a 15 dígitos)" }, { status: 400 });
    await registrarAcesso({ tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: normalizarTelefone(telefone), ip: ipDeHeaders(req.headers), detalhe: "consulta de titular" });
    return NextResponse.json({ status: true, data: resumo });
}
