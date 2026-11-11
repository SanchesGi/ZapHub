// minha versao: LGPD — exporta (JSON) os dados de um titular. So Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import { exigirSuperAdmin, baixarJson } from "@/lib/lgpd-http";
import { exportarTitular } from "@/lib/titular";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { normalizarTelefone } from "@/lib/lgpd-puro";

export async function GET(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const telefone = req.nextUrl.searchParams.get("telefone") || "";
    const dados = await exportarTitular(telefone);
    if (!dados) return NextResponse.json({ status: false, message: "Informe um telefone válido (8 a 15 dígitos)" }, { status: 400 });
    const digitos = normalizarTelefone(telefone);
    await registrarAcesso({ tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: digitos, ip: ipDeHeaders(req.headers), detalhe: `exportação: ${dados.mensagens.length} mensagem(ns)` });
    return baixarJson(`titular-${digitos}.json`, dados);
}
