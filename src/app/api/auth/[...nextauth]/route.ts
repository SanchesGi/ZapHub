import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";

// minha versao: entrega ao Auth.js a requisicao com o endereco REAL (o que o navegador usou), nao o
// http://localhost:3005 que o servidor custom do Next coloca em toda requisicao. Sem isso, login com erro,
// "sair" e os links do Auth.js mandavam quem acessa pelo IP da rede para o localhost do proprio computador.
async function comEnderecoReal(req: NextRequest): Promise<NextRequest> {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host) return req;
    const atual = new URL(req.url);
    if (atual.host === host) return req;
    const proto = (req.headers.get("x-forwarded-proto") ?? atual.protocol).replace(/:$/, "");
    const url = new URL(atual.pathname + atual.search, `${proto}://${host}`);
    const temCorpo = req.method !== "GET" && req.method !== "HEAD";
    return new NextRequest(url, {
        method: req.method,
        headers: req.headers,
        body: temCorpo ? await req.arrayBuffer() : undefined,
    });
}

export async function GET(req: NextRequest) {
    return handlers.GET(await comEnderecoReal(req));
}

export async function POST(req: NextRequest) {
    return handlers.POST(await comEnderecoReal(req));
}
