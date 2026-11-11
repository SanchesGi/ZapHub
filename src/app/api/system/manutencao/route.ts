// minha versao: Manutencao pelo painel (reiniciar, atualizar agora, espaco em disco e limpeza).
// So Super Administrador; so acoes fixas, nunca comando vindo do navegador. Tudo vai para a trilha de Seguranca.
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { verificarAtualizacao } from "@/lib/atualizacao";
import {
    levantarEspaco, limpar, reiniciarEmBreve, diferencaRelogio, atualizarAgora, estadoAtualizador, rodandoPeloSystemd, comandoPreparoVm,
    type ItemEspaco,
} from "@/lib/manutencao";

const ITENS: ItemEspaco["id"][] = ["midia", "build-antigo", "cache-build", "cache-npm", "temporarios", "log-atualizacao"];

async function exigirAdmin(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return { erro: NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 }) };
    if (user.role !== "SUPERADMIN") return { erro: NextResponse.json({ status: false, message: "Somente o Super Administrador" }, { status: 403 }) };
    return { user };
}

export async function GET(req: NextRequest) {
    const a = await exigirAdmin(req);
    if (a.erro) return a.erro;
    // minha versao: consulta o GitHub de verdade (git fetch); antes so comparava com o que a VM ja tinha baixado e
    // mostrava "em dia" logo depois de um merge. Durante uma atualizacao nao busca, para nao disputar o git com ela.
    const atualizador = await estadoAtualizador();
    const [espaco, versao, relogio] = await Promise.all([
        levantarEspaco(),
        verificarAtualizacao(!atualizador.ativo).catch(() => null),
        diferencaRelogio(),
    ]);
    return NextResponse.json({
        status: true,
        data: {
            espaco,
            atualizador,
            versao,
            relogioDiferenca: relogio,
            systemd: rodandoPeloSystemd(),
            comandoPreparo: comandoPreparoVm(),
            iniciadoEm: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
    });
}

/** Corpo: { acao: "reiniciar" } | { acao: "atualizar" } | { acao: "limpar", item, dias? } */
export async function POST(req: NextRequest) {
    const a = await exigirAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));
    const registrar = (detalhe: string) => registrarAcesso({
        tipo: "MANUTENCAO", usuarioId: a.user.id, usuarioEmail: a.user.email, ip: ipDeHeaders(req.headers), detalhe,
    });

    if (body?.acao === "reiniciar") {
        const r = reiniciarEmBreve();
        if (!r.ok) return NextResponse.json({ status: false, message: r.erro }, { status: 400 });
        await registrar("Reiniciou o serviço pelo painel");
        return NextResponse.json({ status: true, message: "Reiniciando. O painel volta em alguns segundos." });
    }

    if (body?.acao === "atualizar") {
        const r = await atualizarAgora();
        if (!r.ok) return NextResponse.json({ status: false, message: r.erro, comando: r.comando }, { status: 400 });
        await registrar("Iniciou a atualização pelo painel");
        return NextResponse.json({ status: true, message: "Atualização iniciada. Acompanhe em Logs > Atualização." });
    }

    if (body?.acao === "limpar") {
        const item = body?.item as ItemEspaco["id"];
        if (!ITENS.includes(item)) return NextResponse.json({ status: false, message: "Item inválido" }, { status: 400 });
        const r = await limpar(item, body?.dias);
        if (!r.ok) return NextResponse.json({ status: false, message: r.erro }, { status: 400 });
        await registrar(`Limpeza: ${item}${r.detalhe ? ` (${r.detalhe})` : ""}, ${r.liberados} bytes`);
        return NextResponse.json({ status: true, message: "Limpeza feita.", data: { liberados: r.liberados, detalhe: r.detalhe } });
    }

    return NextResponse.json({ status: false, message: "Ação desconhecida" }, { status: 400 });
}
