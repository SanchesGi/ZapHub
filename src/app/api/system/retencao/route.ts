// minha versao: LGPD — prazos de retencao (dias) de mensagens, midias e logs. null = guardar para sempre. So Super Administrador.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperAdmin } from "@/lib/lgpd-http";
import { lerConfigRetencao, ultimaExecucao } from "@/lib/retencao";
import { lerDiasRetencao, MINIMO_RETENCAO_DIAS } from "@/lib/lgpd-puro";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";

export async function GET(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const [cfg, ult] = await Promise.all([lerConfigRetencao(), ultimaExecucao()]);
    return NextResponse.json({ status: true, data: { ...cfg, ultimaExecucao: ult.ultimaExecucao, resultado: ult.resultado } });
}

export async function PUT(req: NextRequest) {
    const a = await exigirSuperAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));

    const campos = ["retencaoMensagensDias", "retencaoMidiasDias", "retencaoLogsDias"] as const;
    const novo: Record<string, number | null> = {};
    for (const c of campos) {
        const v = lerDiasRetencao(body?.[c]);
        if (v === undefined) {
            return NextResponse.json({ status: false, message: `Valor inválido em ${c}: use vazio (guardar para sempre) ou um número inteiro de dias, no mínimo ${MINIMO_RETENCAO_DIAS}` }, { status: 400 });
        }
        novo[c] = v;
    }

    await prisma.systemConfig.upsert({
        where: { id: "default" },
        update: novo,
        create: { id: "default", ...novo },
    });
    await registrarAcesso({
        tipo: "LGPD", usuarioId: a.user!.id, usuarioEmail: a.user!.email, alvo: "retencao", ip: ipDeHeaders(req.headers),
        detalhe: `prazos: mensagens ${novo.retencaoMensagensDias ?? "sempre"}, mídias ${novo.retencaoMidiasDias ?? "sempre"}, logs ${novo.retencaoLogsDias ?? "sempre"}`,
    });
    return NextResponse.json({ status: true, message: "Prazos salvos", data: novo });
}
