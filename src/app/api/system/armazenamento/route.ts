// minha versao: Configuracoes > Armazenamento. Mostra e troca a pasta das midias e move os arquivos antigos,
// sem precisar entrar na VM. So Super Administrador. Toda troca vai para a trilha de Seguranca.
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import {
    obterPastaMidia, PASTA_PADRAO, PASTA_SUGERIDA, comandoPreparo, usoDaPasta, mudancaAtual,
    validarCaminho, prepararPasta, definirPastaMidia, iniciarMudanca,
} from "@/lib/pasta-midia";

async function exigirAdmin(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return { erro: NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 }) };
    if (user.role !== "SUPERADMIN") return { erro: NextResponse.json({ status: false, message: "Somente o Super Administrador" }, { status: 403 }) };
    return { user };
}

async function resumo() {
    const atual = await obterPastaMidia();
    const [uso, usoPadrao] = await Promise.all([
        usoDaPasta(atual),
        atual === PASTA_PADRAO ? Promise.resolve(null) : usoDaPasta(PASTA_PADRAO),
    ]);
    return {
        pastaAtual: atual,
        pastaPadrao: PASTA_PADRAO,
        pastaSugerida: PASTA_SUGERIDA,
        comandoSugerido: comandoPreparo(PASTA_SUGERIDA),
        usaPadrao: atual === PASTA_PADRAO,
        uso,
        usoPadrao,
        mudanca: mudancaAtual(),
    };
}

export async function GET(req: NextRequest) {
    const a = await exigirAdmin(req);
    if (a.erro) return a.erro;
    return NextResponse.json({ status: true, data: await resumo() });
}

/** troca a pasta. Corpo: { pasta: string, mover?: boolean } */
export async function PUT(req: NextRequest) {
    const a = await exigirAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));
    const v = validarCaminho(body?.pasta);
    if (!v.ok) return NextResponse.json({ status: false, message: v.erro }, { status: 400 });

    const anterior = await obterPastaMidia();
    if (v.pasta === anterior) return NextResponse.json({ status: true, message: "Essa já é a pasta atual.", data: await resumo() });

    const prep = await prepararPasta(v.pasta);
    if (!prep.ok) return NextResponse.json({ status: false, message: prep.erro, comando: prep.comando }, { status: 400 });

    await definirPastaMidia(v.pasta);
    if (body?.mover) await iniciarMudanca(anterior).catch(() => null);
    await registrarAcesso({
        tipo: "MANUTENCAO", usuarioId: a.user.id, usuarioEmail: a.user.email, ip: ipDeHeaders(req.headers),
        alvo: v.pasta, detalhe: `Pasta de mídia: ${anterior} -> ${v.pasta}${body?.mover ? " (movendo arquivos)" : ""}`,
    });
    return NextResponse.json({ status: true, message: "Pasta alterada. As mídias novas já vão para ela.", data: await resumo() });
}

/** move os arquivos de uma pasta antiga para a atual. Corpo: { origem?: string } (padrao: <app>/data/media) */
export async function POST(req: NextRequest) {
    const a = await exigirAdmin(req);
    if (a.erro) return a.erro;
    const body = await req.json().catch(() => ({}));
    const origem = body?.origem ? validarCaminho(body.origem) : { ok: true as const, pasta: PASTA_PADRAO };
    if (!origem.ok) return NextResponse.json({ status: false, message: origem.erro }, { status: 400 });
    try {
        const m = await iniciarMudanca(origem.pasta);
        await registrarAcesso({
            tipo: "MANUTENCAO", usuarioId: a.user.id, usuarioEmail: a.user.email, ip: ipDeHeaders(req.headers),
            alvo: m.destino, detalhe: `Mover mídias: ${m.origem} -> ${m.destino} (${m.total} arquivos)`,
        });
        return NextResponse.json({ status: true, message: "Movendo os arquivos em segundo plano.", data: await resumo() });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Não consegui iniciar" }, { status: 400 });
    }
}
