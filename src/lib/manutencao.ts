// minha versao: tarefas que antes exigiam entrar na VM, agora pelo painel (Manutencao), so Super Administrador.
//  - reiniciar: o processo se encerra e o systemd o sobe de novo (Restart=always no servico zaphub);
//  - atualizar agora: dispara o servico zaphub-atualizar (roda deploy/atualizar.sh --auto fora deste processo,
//    entao sobrevive ao "parar o servico" da atualizacao). Exige a regra do sudoers do deploy/preparar-vm.sh;
//  - logs: journal do systemd quando o usuario pode ler; senao, as linhas guardadas na memoria e o arquivo
//    logs/atualizacao.log que o atualizar.sh escreve;
//  - espaco: o que ocupa o disco do app (midia, build antigo, caches, temporarios) e limpeza com um clique.
// Nada aqui recebe comando do navegador: so acoes fixas, com argumentos fixos (execFile, sem shell).
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ultimasLinhas } from "./registro-memoria";
import { espacoNoDisco, obterPastaMidia, PASTA_PADRAO, usoDaPasta, apagarMidiasAntigas } from "./pasta-midia";
import { prisma } from "./prisma";

const APP = process.cwd();
const LOG_ATUALIZACAO = path.join(APP, "logs", "atualizacao.log");

function rodar(cmd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; saida: string; erro: string }> {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LANG: "C" } }, (e, stdout, stderr) => {
            resolve({ ok: !e, saida: String(stdout || ""), erro: String(stderr || (e as any)?.message || "") });
        });
    });
}

/** minha versao: servicos systemd do ZapHub */
export function nomeDoServico(): string {
    return "zaphub";
}
export function nomeDoServicoAtualizar(): string {
    return "zaphub-atualizar";
}

/** o app esta rodando pelo systemd? (o systemd define INVOCATION_ID para o servico) */
export function rodandoPeloSystemd(): boolean {
    return !!process.env.INVOCATION_ID && process.platform === "linux";
}

export function comandoPreparoVm(): string {
    return `sudo bash ${path.join(APP, "deploy", "preparar-vm.sh")}`;
}

// ---------------- reiniciar ----------------

export function reiniciarEmBreve(): { ok: true } | { ok: false; erro: string } {
    if (!rodandoPeloSystemd()) return { ok: false, erro: "O ZapHub não está rodando como serviço do systemd; reinicie pelo terminal." };
    // da tempo de a resposta chegar ao navegador; o systemd sobe de novo em ~5 s
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 1200);
    return { ok: true };
}

// ---------------- atualizar ----------------

export async function estadoAtualizador(): Promise<{ ativo: boolean; instalado: boolean }> {
    if (process.platform !== "linux") return { ativo: false, instalado: false };
    const ativo = await rodar("systemctl", ["is-active", nomeDoServicoAtualizar()]);
    const existe = await rodar("systemctl", ["cat", nomeDoServicoAtualizar()]);
    return { ativo: ativo.saida.trim() === "activating" || ativo.saida.trim() === "active", instalado: existe.ok };
}

export async function atualizarAgora(): Promise<{ ok: true } | { ok: false; erro: string; comando?: string }> {
    if (!rodandoPeloSystemd()) return { ok: false, erro: "O ZapHub não está rodando como serviço do systemd." };
    const est = await estadoAtualizador();
    if (est.ativo) return { ok: false, erro: "Já existe uma atualização em andamento." };
    if (!est.instalado) return { ok: false, erro: "A atualização pelo painel ainda não foi preparada nesta VM. Rode o comando abaixo uma vez.", comando: comandoPreparoVm() };
    // marca para o atualizar.sh contar tudo no log (ver deploy/atualizar.sh)
    const marca = path.join(APP, ".atualizar-pelo-painel");
    await fs.writeFile(marca, new Date().toISOString()).catch(() => {});
    const r = await rodar("sudo", ["-n", "systemctl", "start", "--no-block", nomeDoServicoAtualizar()]);
    if (!r.ok) {
        await fs.unlink(marca).catch(() => {});
        return { ok: false, erro: "Sem permissão para iniciar a atualização. Rode o comando abaixo uma vez na VM.", comando: comandoPreparoVm() };
    }
    return { ok: true };
}

// ---------------- relogio ----------------

/**
 * diferenca (segundos) entre o relogio desta VM e o de um servidor confiavel (cabecalho Date da API do GitHub,
 * precisao de 1 s). Positivo = VM adiantada. Relogio errado baguca a ordem das mensagens e os horarios.
 */
export async function diferencaRelogio(): Promise<number | null> {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const antes = Date.now();
        const r = await fetch("https://api.github.com", { method: "HEAD", signal: ctrl.signal, cache: "no-store" });
        clearTimeout(t);
        const depois = Date.now();
        const data = r.headers.get("date");
        if (!data) return null;
        const remoto = new Date(data).getTime();
        if (!Number.isFinite(remoto)) return null;
        return Math.round(((antes + depois) / 2 - remoto) / 1000);
    } catch {
        return null;
    }
}

// ---------------- logs ----------------

export type FonteLog = "servico" | "atualizacao";

export async function lerLogs(fonte: FonteLog, n = 400): Promise<{ origem: string; linhas: string[] }> {
    const unidade = fonte === "servico" ? nomeDoServico() : nomeDoServicoAtualizar();
    if (process.platform === "linux") {
        const j = await rodar("journalctl", ["-u", unidade, "-n", String(n), "--no-pager", "-o", "short-iso"]);
        const linhas = j.saida.split("\n").filter((l) => l.trim() && !l.startsWith("-- No entries") && !l.startsWith("Hint:"));
        if (j.ok && linhas.length > 1) return { origem: `journal (${unidade})`, linhas };
    }
    if (fonte === "atualizacao") {
        try {
            const txt = await fs.readFile(LOG_ATUALIZACAO, "utf8");
            return { origem: "logs/atualizacao.log", linhas: txt.split("\n").filter(Boolean).slice(-n) };
        } catch {
            return { origem: "logs/atualizacao.log", linhas: [] };
        }
    }
    return {
        origem: "memória do servidor (desde o último início)",
        linhas: ultimasLinhas(n).map((l) => `${l.t} ${l.nivel === "erro" ? "ERRO " : l.nivel === "aviso" ? "AVISO " : ""}${l.texto}`),
    };
}

// ---------------- espaco ----------------

export type ItemEspaco = {
    id: "midia" | "midia-antiga" | "build-antigo" | "cache-build" | "cache-npm" | "temporarios" | "log-atualizacao";
    nome: string;
    caminho: string;
    bytes: number | null;
    limpavel: boolean;
    explicacao: string;
};

async function tamanho(p: string): Promise<number | null> {
    try { await fs.access(p); } catch { return 0; }
    if (process.platform === "linux") {
        const r = await rodar("du", ["-sb", p], 60000);
        const n = Number.parseInt(r.saida.split(/\s/)[0] || "", 10);
        if (Number.isFinite(n)) return n;
    }
    // fora do Linux (desenvolvimento): soma recursiva simples
    let total = 0;
    try {
        const s = await fs.stat(p);
        if (!s.isDirectory()) return s.size;
        for (const nome of await fs.readdir(p)) total += (await tamanho(path.join(p, nome))) || 0;
    } catch { return null; }
    return total;
}

const PASTA_TMP_VOZ = path.join(os.tmpdir(), "wa-voz");
const CACHE_NPM = path.join(os.homedir(), ".npm", "_cacache");

export async function levantarEspaco() {
    const atual = await obterPastaMidia();
    const itens: ItemEspaco[] = [];
    const usoAtual = await usoDaPasta(atual);
    itens.push({ id: "midia", nome: "Mídias (pasta atual)", caminho: atual, bytes: usoAtual.bytes, limpavel: true, explicacao: "Imagens, áudios, vídeos e documentos recebidos. Dá para apagar os mais antigos." });
    if (atual !== PASTA_PADRAO) {
        const antiga = await usoDaPasta(PASTA_PADRAO);
        if (antiga.arquivos > 0) itens.push({ id: "midia-antiga", nome: "Mídias na pasta antiga", caminho: PASTA_PADRAO, bytes: antiga.bytes, limpavel: false, explicacao: "Ainda não foram movidas. Use \"Mover arquivos\" em Armazenamento." });
    }
    const add = async (id: ItemEspaco["id"], nome: string, caminho: string, explicacao: string) => {
        itens.push({ id, nome, caminho, bytes: await tamanho(caminho), limpavel: true, explicacao });
    };
    await add("build-antigo", "Versão anterior do sistema", path.join(APP, ".next.old"), "Cópia guardada para voltar atrás se a atualização falhar. Pode apagar depois que a versão nova estiver funcionando.");
    await add("cache-build", "Cache de compilação", path.join(APP, ".next", "cache"), "Acelera a próxima atualização. Apagar só deixa a próxima compilação mais lenta.");
    await add("cache-npm", "Cache de downloads do npm", CACHE_NPM, "Cópias dos pacotes baixados. O npm baixa de novo quando precisar.");
    await add("temporarios", "Temporários de áudio", PASTA_TMP_VOZ, "Sobras da conversão de mensagens de voz.");
    await add("log-atualizacao", "Log das atualizações", LOG_ATUALIZACAO, "Histórico das atualizações feitas pela VM.");

    const discos: { nome: string; caminho: string; livre: number; total: number }[] = [];
    for (const [nome, caminho] of [["Disco do aplicativo", APP], ["Disco das mídias", atual]] as const) {
        const d = await espacoNoDisco(caminho);
        if (d && !discos.some((x) => x.total === d.total && x.livre === d.livre)) discos.push({ nome, caminho, ...d });
    }
    return { itens, discos };
}

async function apagarTudo(p: string) {
    await fs.rm(p, { recursive: true, force: true });
}

export async function limpar(id: ItemEspaco["id"], dias?: number): Promise<{ ok: true; liberados: number; detalhe?: string } | { ok: false; erro: string }> {
    const atualizando = (await estadoAtualizador()).ativo;
    switch (id) {
        case "midia": {
            const d = Math.floor(Number(dias));
            if (!Number.isFinite(d) || d < 7) return { ok: false, erro: "Escolha pelo menos 7 dias." };
            const r = await apagarMidiasAntigas(d);
            // as mensagens continuam apontando para o arquivo: sem ele no disco, a tela mostra "tentar de novo"
            // (baixa de novo do WhatsApp enquanto existir la, com os dados de download guardados na mensagem).
            // A retencao da LGPD e diferente: ela apaga tambem os dados de download (lib/retencao.ts).
            return { ok: true, liberados: r.bytes, detalhe: `${r.apagados} arquivo(s) com mais de ${d} dias` };
        }
        case "build-antigo":
        case "cache-build":
        case "cache-npm": {
            if (atualizando) return { ok: false, erro: "Há uma atualização em andamento; tente quando ela terminar." };
            const alvo = id === "build-antigo" ? path.join(APP, ".next.old") : id === "cache-build" ? path.join(APP, ".next", "cache") : CACHE_NPM;
            const antes = (await tamanho(alvo)) || 0;
            await apagarTudo(alvo);
            return { ok: true, liberados: antes };
        }
        case "temporarios": {
            let liberados = 0;
            const limite = Date.now() - 3_600_000; // so os com mais de 1 hora (os recentes podem estar em uso)
            try {
                for (const nome of await fs.readdir(PASTA_TMP_VOZ)) {
                    const p = path.join(PASTA_TMP_VOZ, nome);
                    const s = await fs.stat(p).catch(() => null);
                    if (s?.isFile() && s.mtimeMs < limite) { await fs.unlink(p).catch(() => {}); liberados += s.size; }
                }
            } catch { /* pasta nao existe */ }
            return { ok: true, liberados };
        }
        case "log-atualizacao": {
            const antes = (await tamanho(LOG_ATUALIZACAO)) || 0;
            await fs.writeFile(LOG_ATUALIZACAO, "").catch(() => {});
            return { ok: true, liberados: antes };
        }
        default:
            return { ok: false, erro: "Item desconhecido." };
    }
}
