// minha versao: verifica atualizacao comparando o git LOCAL com o SEU repositorio (origin), sem token.
// Usa o mesmo remoto que voce clonou (o origin). Nada aponta para o repo do autor original.
import { execSync } from "child_process";

export type InfoAtualizacao = {
    disponivel: boolean;
    atras: number;            // quantos commits a VM esta atras do GitHub
    localSha: string | null;
    remotoSha: string | null;
    repo: string | null;      // ex.: SanchesGi/ZapHub
    url: string | null;       // link do repositorio
    erro?: string;
};

function git(args: string, timeout = 15000): string {
    return execSync(`git ${args}`, { cwd: process.cwd(), timeout, stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim();
}

// descobre o dono/nome a partir do remoto configurado (origin)
export function repoDoOrigin(): { repo: string | null; url: string | null } {
    try {
        const url = git("remote get-url origin");
        const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
        if (m) return { repo: `${m[1]}/${m[2]}`, url: `https://github.com/${m[1]}/${m[2]}` };
        return { repo: null, url: url.replace(/\.git$/, "") };
    } catch {
        return { repo: null, url: null };
    }
}

export async function verificarAtualizacao(buscarRemoto = true): Promise<InfoAtualizacao> {
    const { repo, url } = repoDoOrigin();
    try {
        if (buscarRemoto) { try { git("fetch --quiet origin", 30000); } catch { /* sem rede: compara o que ja tem */ } }
        const localSha = git("rev-parse HEAD");
        let remotoSha: string;
        try { remotoSha = git("rev-parse @{u}"); } catch { remotoSha = git("rev-parse origin/main"); }
        let atras = 0;
        try { atras = parseInt(git(`rev-list --count HEAD..${remotoSha}`) || "0", 10) || 0; } catch { /* ignora */ }
        return { disponivel: localSha !== remotoSha && atras > 0, atras, localSha, remotoSha, repo, url };
    } catch (e: any) {
        return { disponivel: false, atras: 0, localSha: null, remotoSha: null, repo, url, erro: e?.message || "git indisponivel" };
    }
}
