// minha versao: IP do cliente. O servidor (src/server/index.ts) grava o IP real no cabecalho interno x-zaphub-ip
// ANTES de entregar o pedido ao Next, sempre sobrescrevendo o que o cliente mandou. X-Forwarded-For so e usado
// se TRUST_PROXY=true (proxy reverso proprio na frente), e entao vale a ULTIMA entrada (a que o proxy acrescentou),
// nunca a primeira, que o cliente controla.
export const CABECALHO_IP = "x-zaphub-ip";

type PedidoNode = { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } };

export function definirIpDoCliente(req: PedidoNode, confiarNoProxy = process.env.TRUST_PROXY === "true"): string {
    let ip = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    if (confiarNoProxy) {
        const xff = req.headers["x-forwarded-for"];
        const lista = (Array.isArray(xff) ? xff.join(",") : xff || "").split(",").map((s) => s.trim()).filter(Boolean);
        const real = lista.length ? lista[lista.length - 1] : String(req.headers["x-real-ip"] || "").trim();
        if (real) ip = real;
    }
    ip = ip.slice(0, 64) || "desconhecido";
    req.headers[CABECALHO_IP] = ip;
    return ip;
}

export function ipDoCliente(h: Headers | null | undefined): string | null {
    try {
        return h?.get(CABECALHO_IP) || null;
    } catch {
        return null;
    }
}
