// minha versao: previa de link para a tela do chat (mensagens que nao vieram com previa do WhatsApp).
// So usuario logado; limite por usuario (o servidor busca paginas de fora, entao nao pode virar um robo).
// A busca em si e segura (src/lib/previa-link.ts -> safeFetchBuffer: sem IP interno, com limite de tamanho).
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { limitarTaxa, resposta429 } from "@/lib/rate-limit";
import { obterPrevia, primeiroLink } from "@/lib/previa-link";

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const rl = limitarTaxa(`previa:${user.id}`, 60, 60 * 1000);
    if (!rl.ok) return resposta429(rl.emSegundos);

    const url = primeiroLink(req.nextUrl.searchParams.get("url") || "");
    if (!url) return NextResponse.json({ status: false, message: "URL inválida" }, { status: 400 });

    const previa = await obterPrevia(url);
    // so guarda no navegador quando ha previa: uma falha passageira nao pode ficar presa por 1 hora
    return NextResponse.json(
        { status: true, data: previa },
        { headers: { "Cache-Control": previa ? "private, max-age=3600" : "no-store" } },
    );
}
