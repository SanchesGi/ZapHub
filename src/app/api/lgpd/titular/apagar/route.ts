// minha versao: LGPD — apaga TUDO que o sistema guarda sobre um titular (mensagens, arquivos de midia, contatos,
// estados de conversa, etiquetas, envios em massa, agendadas). So Super Administrador. Nunca envia nada ao WhatsApp.
import { NextRequest, NextResponse } from "next/server";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { apagarTitular } from "@/lib/titular";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { normalizarTelefone } from "@/lib/lgpd-puro";

export async function POST(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));
    if (body?.confirmacao !== "APAGAR") {
        return NextResponse.json({ status: false, error: "confirmacao_invalida", message: "Digite APAGAR para confirmar" }, { status: 400 });
    }
    const telefone = typeof body?.telefone === "string" ? body.telefone : "";
    try {
        const r = await apagarTitular(telefone);
        if (!r) return NextResponse.json({ status: false, message: "Informe um telefone válido (8 a 15 dígitos)" }, { status: 400 });
        await registrarAcesso({
            tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: normalizarTelefone(telefone), ip: ipDeHeaders(req.headers),
            detalhe: `titular apagado: ${r.mensagens} mensagem(ns), ${r.midias} arquivo(s), ${r.contatos} contato(s)`,
        });
        return NextResponse.json({ status: true, message: "Dados do titular apagados", data: r });
    } catch (error) {
        console.error("Apagar titular error:", error);
        return NextResponse.json({ status: false, message: "Não foi possível apagar os dados do titular" }, { status: 500 });
    }
}
