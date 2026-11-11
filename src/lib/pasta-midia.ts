// minha versao: pasta onde ficam as midias recebidas (imagens, audios, videos, documentos, figurinhas).
// Antes era fixa em <app>/data/media, dentro do /home da VM (10 GB, sempre lotado). Agora o Super Administrador
// escolhe a pasta pelo painel (Configuracoes > Armazenamento) e move os arquivos antigos sem entrar na VM.
//
// Seguranca: a pasta e escolhida pelo painel, entao nao pode virar uma janela para o resto do disco.
//  - so caminho absoluto simples (letras, numeros, / _ . -), nunca pasta do sistema nem dentro do app;
//  - so vira pasta de midia se estiver vazia ou ja tiver a marca .zaphub-midia (criada aqui);
//  - so servimos nomes no formato das midias (<sessao>-<mensagem>.<ext>), nunca .env ou outro arquivo.
// O estado fica no globalThis: o servidor (Baileys) e as rotas do Next rodam no mesmo processo, mas com
// copias separadas deste modulo; assim os dois enxergam a mesma pasta e o mesmo andamento da mudanca.
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { prisma } from "./prisma";

export const PASTA_PADRAO = path.join(process.cwd(), "data", "media");
export const PASTA_SUGERIDA = "/var/lib/zaphub/midia";
const MARCA = ".zaphub-midia";
const ehMarca = (n: string) => n === MARCA;
const CACHE_MS = 30_000;

// nome de arquivo de midia: <sessao>-<mensagem>.<ext> (os dois ja saneados para [A-Za-z0-9_-]).
// Conferido em partes, sem uma regex unica com classes sobrepostas (que pode ficar lenta com texto enorme).
const BASE_MIDIA = /^[\w-]+$/;
const EXT_MIDIA = /^[A-Za-z0-9]{1,10}$/;
const CAMINHO_SIMPLES = /^\/[A-Za-z0-9/_.-]+$/;
const PROIBIDAS = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var/log", "/var/run", "/var/lib/mysql"];

export type Mudanca = {
    rodando: boolean;
    origem: string;
    destino: string;
    total: number;
    movidos: number;
    bytes: number;
    erros: number;
    ultimoErro?: string;
    inicio: string;
    fim?: string;
};

type Estado = { pasta: string | null; ate: number; mudanca: Mudanca | null };
const G = globalThis as unknown as { __waPastaMidia?: Estado };
const estado: Estado = (G.__waPastaMidia ??= { pasta: null, ate: 0, mudanca: null });

export function nomeDeMidiaValido(nome: string): boolean {
    if (typeof nome !== "string" || nome.length > 200) return false;
    const ponto = nome.lastIndexOf(".");
    if (ponto <= 0) return false;
    const base = nome.slice(0, ponto);
    const traco = base.indexOf("-", 1); // precisa de <sessao>-<mensagem>, os dois nao vazios
    return BASE_MIDIA.test(base) && traco > 0 && traco < base.length - 1 && EXT_MIDIA.test(nome.slice(ponto + 1));
}

/** pasta atual (configurada no painel, ou a padrao). Le do banco no maximo a cada 30 s. */
export async function obterPastaMidia(): Promise<string> {
    if (estado.pasta && Date.now() < estado.ate) return estado.pasta;
    let pasta = PASTA_PADRAO;
    try {
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" }, select: { pastaMidia: true } });
        if (cfg?.pastaMidia) pasta = cfg.pastaMidia;
    } catch {
        // coluna ainda nao criada (antes do prisma db push): segue na padrao
    }
    estado.pasta = pasta;
    estado.ate = Date.now() + CACHE_MS;
    return pasta;
}

/** onde procurar um arquivo: a pasta atual e, se for outra, a padrao (arquivos que ainda nao foram movidos) */
export async function pastasDeLeitura(): Promise<string[]> {
    const atual = await obterPastaMidia();
    const outras = [estado.mudanca?.origem, PASTA_PADRAO].filter((p): p is string => !!p && p !== atual);
    return [atual, ...new Set(outras)];
}

/** caminho completo de uma midia existente, ou null. Recusa nome fora do formato de midia. */
export async function localizarMidia(nome: string): Promise<string | null> {
    if (!nomeDeMidiaValido(nome)) return null;
    for (const pasta of await pastasDeLeitura()) {
        const p = path.join(pasta, nome);
        try {
            if ((await fs.stat(p)).isFile()) return p;
        } catch { /* nao esta nesta pasta */ }
    }
    return null;
}

/** caminho para gravar uma midia nova (cria a pasta se faltar) */
export async function caminhoParaGravar(nome: string): Promise<string> {
    if (!nomeDeMidiaValido(nome)) throw new Error(`Nome de mídia inválido: ${nome}`);
    const pasta = await obterPastaMidia();
    await fs.mkdir(pasta, { recursive: true });
    return path.join(pasta, nome);
}

/** nome da midia a partir do mediaUrl gravado na mensagem ("/api/media/<nome>") */
export function nomeDoMediaUrl(mediaUrl: string | null | undefined): string | null {
    if (!mediaUrl) return null;
    const m = /^\/api\/media\/([^/?#]+)$/.exec(mediaUrl);
    if (!m) return null;
    try {
        const nome = decodeURIComponent(m[1]);
        return nomeDeMidiaValido(nome) ? nome : null;
    } catch {
        return null;
    }
}

/** usuario do sistema que roda o app (para o comando de preparo da pasta) */
export function usuarioDoApp(): string {
    try { return os.userInfo().username; } catch { return "SEU_USUARIO"; }
}

export function comandoPreparo(pasta: string): string {
    return `sudo mkdir -p ${pasta} && sudo chown ${usuarioDoApp()}: ${pasta}`;
}

/** confere se o caminho pode ser pasta de midia (sem tocar no disco) */
export function validarCaminho(entrada: string): { ok: true; pasta: string } | { ok: false; erro: string } {
    const limpo = String(entrada || "").trim();
    if (!limpo) return { ok: false, erro: "Informe a pasta." };
    if (limpo.length > 200) return { ok: false, erro: "Caminho longo demais." };
    let bruto = limpo;
    while (bruto.length > 1 && bruto.endsWith("/")) bruto = bruto.slice(0, -1);
    if (path.resolve(bruto) === path.resolve(PASTA_PADRAO)) return { ok: true, pasta: PASTA_PADRAO };
    if (!CAMINHO_SIMPLES.test(bruto) || bruto.split("/").includes("..") || bruto.split("/").includes(".")) {
        return { ok: false, erro: "Use um caminho absoluto simples, por exemplo /var/lib/zaphub/midia (só letras, números, / _ . -)." };
    }
    const pasta = path.posix.normalize(bruto);
    if (pasta === "/" || pasta.split("/").length < 3) return { ok: false, erro: "Escolha uma pasta com pelo menos dois níveis, por exemplo /var/lib/zaphub/midia." };
    if (PROIBIDAS.some((p) => pasta === p || pasta.startsWith(p + "/"))) return { ok: false, erro: "Essa pasta é do sistema. Use, por exemplo, /var/lib/zaphub/midia." };
    const app = path.resolve(process.cwd());
    if (pasta === app || pasta.startsWith(app + "/") || app.startsWith(pasta + "/")) {
        return { ok: false, erro: "A pasta não pode ser a do aplicativo nem ficar dentro dela." };
    }
    return { ok: true, pasta };
}

/**
 * Prepara a pasta (cria, testa a escrita, confere que e vazia ou ja e de midia e grava a marca).
 * Nao muda a configuracao: so diz se da para usar.
 */
export async function prepararPasta(pasta: string): Promise<{ ok: true } | { ok: false; erro: string; comando?: string }> {
    const semPermissao = (e: any) => e?.code === "EACCES" || e?.code === "EPERM" || e?.code === "EROFS";
    try {
        await fs.mkdir(pasta, { recursive: true });
    } catch (e: any) {
        if (semPermissao(e)) return { ok: false, erro: "O aplicativo não tem permissão para criar essa pasta. Rode o comando abaixo uma vez na VM e tente de novo.", comando: comandoPreparo(pasta) };
        return { ok: false, erro: `Não consegui criar a pasta (${e?.code || e?.message}).` };
    }
    if (pasta !== PASTA_PADRAO) {
        let nomes: string[];
        try { nomes = await fs.readdir(pasta); } catch (e: any) {
            return { ok: false, erro: `Não consegui ler a pasta (${e?.code || e?.message}).`, comando: semPermissao(e) ? comandoPreparo(pasta) : undefined };
        }
        const estranhos = nomes.filter((n) => !ehMarca(n) && n !== ".gitkeep" && !nomeDeMidiaValido(n));
        if (!nomes.some(ehMarca) && estranhos.length > 0) {
            return { ok: false, erro: `A pasta já tem outros arquivos (${estranhos.slice(0, 3).join(", ")}${estranhos.length > 3 ? "…" : ""}). Escolha uma pasta vazia, só para as mídias.` };
        }
    }
    const teste = path.join(pasta, `.teste-${process.pid}-${Date.now()}`);
    try {
        await fs.writeFile(teste, "ok");
        await fs.unlink(teste);
        await fs.writeFile(path.join(pasta, MARCA), "Pasta de midias do ZapHub. Nao coloque outros arquivos aqui.\n");
    } catch (e: any) {
        return {
            ok: false,
            erro: semPermissao(e) ? "O aplicativo não consegue gravar nessa pasta. Rode o comando abaixo uma vez na VM e tente de novo." : `Não consegui gravar na pasta (${e?.code || e?.message}).`,
            comando: semPermissao(e) ? comandoPreparo(pasta) : undefined,
        };
    }
    return { ok: true };
}

/** grava a pasta nova na configuracao (ja preparada) */
export async function definirPastaMidia(pasta: string): Promise<void> {
    const valor = pasta === PASTA_PADRAO ? null : pasta;
    await prisma.systemConfig.upsert({
        where: { id: "default" },
        update: { pastaMidia: valor },
        create: { id: "default", pastaMidia: valor },
    });
    estado.pasta = pasta;
    estado.ate = Date.now() + CACHE_MS;
}

export type UsoPasta = { pasta: string; arquivos: number; bytes: number; livre: number | null; total: number | null; existe: boolean };

/** quantos arquivos/bytes a pasta tem e quanto sobra no disco dela */
export async function usoDaPasta(pasta: string): Promise<UsoPasta> {
    let arquivos = 0, bytes = 0, existe = true;
    try {
        for (const nome of await fs.readdir(pasta)) {
            if (!nomeDeMidiaValido(nome)) continue;
            try { const s = await fs.stat(path.join(pasta, nome)); if (s.isFile()) { arquivos++; bytes += s.size; } } catch { /* sumiu */ }
        }
    } catch { existe = false; }
    const disco = await espacoNoDisco(existe ? pasta : path.dirname(pasta));
    return { pasta, arquivos, bytes, livre: disco?.livre ?? null, total: disco?.total ?? null, existe };
}

export async function espacoNoDisco(pasta: string): Promise<{ livre: number; total: number } | null> {
    let alvo = pasta;
    for (let i = 0; i < 6; i++) {
        try {
            const s = await fs.statfs(alvo);
            return { livre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
        } catch {
            const pai = path.dirname(alvo);
            if (pai === alvo) break;
            alvo = pai;
        }
    }
    return null;
}

/** a pasta padrao, ou uma que tenha a marca .zaphub-midia (criada por prepararPasta) */
export async function ehPastaDeMidia(pasta: string): Promise<boolean> {
    if (path.resolve(pasta) === path.resolve(PASTA_PADRAO)) return true;
    try { await fs.access(path.join(pasta, MARCA)); return true; } catch { return false; }
}

export function mudancaAtual(): Mudanca | null {
    return estado.mudanca;
}

/**
 * Move as midias de `origem` para a pasta atual, em segundo plano. Entre discos diferentes nao da para
 * renomear, entao copia, confere o tamanho e so depois apaga o original. Enquanto move, as duas pastas
 * sao lidas (localizarMidia), entao nada some da tela.
 */
export async function iniciarMudanca(origem: string): Promise<Mudanca> {
    if (estado.mudanca?.rodando) return estado.mudanca;
    const destino = await obterPastaMidia();
    if (path.resolve(origem) === path.resolve(destino)) throw new Error("A origem é a própria pasta atual.");
    // so move de pasta que e de midia (a padrao ou uma marcada por prepararPasta): nunca de pasta de outro programa
    if (!(await ehPastaDeMidia(origem))) throw new Error("A origem não é uma pasta de mídias do ZapHub.");
    let nomes: string[] = [];
    try { nomes = (await fs.readdir(origem)).filter(nomeDeMidiaValido); } catch { nomes = []; }
    const m: Mudanca = { rodando: true, origem, destino, total: nomes.length, movidos: 0, bytes: 0, erros: 0, inicio: new Date().toISOString() };
    estado.mudanca = m;
    void (async () => {
        for (const nome of nomes) {
            const de = path.join(origem, nome);
            const para = path.join(destino, nome);
            try {
                const s = await fs.stat(de);
                let jaExiste = false;
                try { jaExiste = (await fs.stat(para)).size === s.size; } catch { /* nao existe */ }
                if (!jaExiste) {
                    const tmp = `${para}.parcial`;
                    await fs.copyFile(de, tmp);
                    if ((await fs.stat(tmp)).size !== s.size) { await fs.unlink(tmp).catch(() => {}); throw new Error("cópia incompleta"); }
                    await fs.utimes(tmp, s.atime, s.mtime).catch(() => {}); // mantem a data (limpeza por idade)
                    await fs.rename(tmp, para);
                }
                await fs.unlink(de);
                m.movidos++;
                m.bytes += s.size;
            } catch (e: any) {
                m.erros++;
                m.ultimoErro = `${nome}: ${e?.code || e?.message || e}`;
                if (e?.code === "ENOSPC") break; // disco de destino cheio: para e avisa
            }
        }
        m.rodando = false;
        m.fim = new Date().toISOString();
    })();
    return m;
}

/** apaga midias com mais de `dias` dias (todas as pastas lidas). Devolve quantas e quantos bytes. */
export async function apagarMidiasAntigas(dias: number): Promise<{ apagados: number; bytes: number; nomes: string[] }> {
    const limite = Date.now() - dias * 86_400_000;
    let apagados = 0, bytes = 0;
    const apagadosNomes: string[] = [];
    for (const pasta of await pastasDeLeitura()) {
        let nomes: string[] = [];
        try { nomes = (await fs.readdir(pasta)).filter(nomeDeMidiaValido); } catch { continue; }
        for (const nome of nomes) {
            const p = path.join(pasta, nome);
            try {
                const s = await fs.stat(p);
                if (s.isFile() && s.mtimeMs < limite) { await fs.unlink(p); apagados++; bytes += s.size; apagadosNomes.push(nome); }
            } catch { /* segue */ }
        }
    }
    return { apagados, bytes, nomes: apagadosNomes };
}
