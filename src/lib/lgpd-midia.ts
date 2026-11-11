// minha versao: LGPD — apaga arquivos de midia a partir do mediaUrl gravado nas mensagens ("/api/media/<nome>").
// Apaga em todas as pastas lidas (a atual e a antiga, se a mudanca de pasta ainda nao terminou).
import path from "node:path";
import { promises as fs } from "node:fs";
import { nomeDoMediaUrl, pastasDeLeitura } from "./pasta-midia";

export async function apagarArquivosDeMidia(mediaUrls: (string | null | undefined)[]): Promise<{ arquivos: number; bytes: number }> {
    const nomes = new Set<string>();
    for (const u of mediaUrls) {
        const n = nomeDoMediaUrl(u);
        if (n) nomes.add(n);
    }
    if (!nomes.size) return { arquivos: 0, bytes: 0 };
    const pastas = await pastasDeLeitura();
    let arquivos = 0, bytes = 0;
    for (const nome of nomes) {
        let apagou = false;
        for (const pasta of pastas) {
            const p = path.join(pasta, nome);
            try {
                const s = await fs.stat(p);
                if (!s.isFile()) continue;
                await fs.unlink(p);
                bytes += s.size;
                apagou = true;
            } catch { /* nao esta nesta pasta */ }
        }
        if (apagou) arquivos++;
    }
    return { arquivos, bytes };
}
