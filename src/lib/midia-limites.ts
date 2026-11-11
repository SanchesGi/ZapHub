// minha versao: limites da midia RECEBIDA (um contato qualquer pode mandar arquivo grande).
//  - cada arquivo: no maximo MIDIA_MAX_MB (padrao 100 MB), lido em fluxo e cortado ao passar do limite;
//  - disco: nao baixa se a pasta de midia tiver menos que MIDIA_MIN_LIVRE_MB livres (padrao 1024 MB).
// A mensagem fica com a midia pendente (a fila tenta de novo e a tela oferece "tentar de novo").
import type { Readable } from "node:stream";

export function limiteMidiaBytes(env = process.env.MIDIA_MAX_MB): number {
    const mb = Number(env);
    return (Number.isFinite(mb) && mb > 0 ? mb : 100) * 1024 * 1024;
}

export function minimoLivreBytes(env = process.env.MIDIA_MIN_LIVRE_MB): number {
    const mb = Number(env);
    return (Number.isFinite(mb) && mb >= 0 ? mb : 1024) * 1024 * 1024;
}

/** tamanho declarado na mensagem (number, string ou Long do protobuf); null se nao veio */
export function tamanhoDeclarado(fileLength: unknown): number | null {
    if (fileLength === null || fileLength === undefined) return null;
    const n = typeof fileLength === "object" && typeof (fileLength as any).toNumber === "function"
        ? (fileLength as any).toNumber()
        : Number(fileLength);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** le o fluxo inteiro ate `maxBytes`; passou do limite ou do tempo, destroi o fluxo e rejeita */
export async function lerFluxoComLimite(fluxo: Readable, maxBytes: number, timeoutMs?: number): Promise<Buffer> {
    const partes: Buffer[] = [];
    let total = 0;
    const relogio = timeoutMs ? setTimeout(() => fluxo.destroy(new Error(`tempo esgotado (${Math.round(timeoutMs / 1000)} s)`)), timeoutMs) : null;
    try {
        for await (const parte of fluxo) {
            const b = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
            total += b.length;
            if (total > maxBytes) {
                fluxo.destroy();
                throw new Error(`arquivo maior que o limite (${Math.round(maxBytes / 1024 / 1024)} MB)`);
            }
            partes.push(b);
        }
    } finally {
        if (relogio) clearTimeout(relogio);
    }
    return Buffer.concat(partes);
}
