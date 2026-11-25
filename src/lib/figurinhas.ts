// minha versao: colecao de figurinhas por atendente (banco + disco). As regras puras ficam em figurinha-puro.ts.
// O arquivo mora na pasta de midia, em figurinhas/<sha256>.webp, e e compartilhado entre os atendentes que guardaram
// a mesma figurinha: so se apaga do disco quando ninguem mais a usa. Nunca expomos o caminho do disco: a tela
// pede a imagem por GET /api/figurinhas/<id>, que confere o dono.
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "./prisma";
import { emSerie } from "./fila-por-chave";
import { obterPastaMidia, pastasDeLeitura } from "./pasta-midia";
import { MAX_BYTES_FIGURINHA, SUBPASTA_FIGURINHAS, hashDoArquivo, ordenarFigurinhas, validarFigurinha } from "./figurinha-puro";

// uma de cada vez: contar, conferir duplicidade e gravar (sem @@unique no banco) nao pode correr em paralelo
const FILA = "figurinhas";

/** caminho do arquivo numa pasta de midia; null se o nome gravado nao for um sha256 valido (nunca monta caminho com texto livre) */
function caminhoNaPasta(pasta: string, arquivo: string): string | null {
    const hash = hashDoArquivo(arquivo);
    return hash ? path.join(pasta, SUBPASTA_FIGURINHAS, `${hash}.webp`) : null;
}

/** le o arquivo da figurinha (pasta atual, ou a antiga enquanto a mudanca de pasta nao termina) */
export async function lerArquivoFigurinha(arquivo: string): Promise<Buffer | null> {
    for (const pasta of await pastasDeLeitura()) {
        const p = caminhoNaPasta(pasta, arquivo);
        if (!p) return null;
        try {
            const s = await fs.stat(p);
            if (s.isFile() && s.size <= MAX_BYTES_FIGURINHA) return await fs.readFile(p);
        } catch { /* nao esta nesta pasta */ }
    }
    return null;
}

async function apagarArquivo(arquivo: string): Promise<void> {
    for (const pasta of await pastasDeLeitura()) {
        const p = caminhoNaPasta(pasta, arquivo);
        if (p) await fs.unlink(p).catch(() => {});
    }
}

export type ResultadoSalvar =
    | { ok: true; id: string; nova: boolean; animada: boolean }
    | { ok: false; erro: string };

/** guarda o webp na colecao do usuario (confere formato, 1 MB, 300 por usuario e se ele ja tem a mesma) */
export function salvarFigurinhaDoUsuario(userId: string, dados: Buffer): Promise<ResultadoSalvar> {
    return emSerie(`${FILA}:${userId}`, async (): Promise<ResultadoSalvar> => { // minha versao: fila por usuario (um nao trava os outros)
        const total = await prisma.figurinha.count({ where: { userId } });
        // a conferencia de "ja tem" precisa do banco: valida o formato, consulta o hash e so entao aplica o limite
        const v = validarFigurinha(dados, 0);
        if (!v.ok) return v;
        const ja = await prisma.figurinha.findFirst({ where: { userId, hash: v.hash }, select: { id: true, animada: true } });
        if (ja) return { ok: true, id: ja.id, nova: false, animada: ja.animada };
        const limite = validarFigurinha(dados, total);
        if (!limite.ok) return limite;

        const pasta = await obterPastaMidia();
        const destino = caminhoNaPasta(pasta, v.arquivo);
        if (!destino) return { ok: false, erro: "Figurinha inválida." };
        await fs.mkdir(path.dirname(destino), { recursive: true });
        let existe = false;
        try { existe = (await fs.stat(destino)).isFile(); } catch { /* ainda nao existe */ }
        if (!existe) {
            const tmp = `${destino}.${process.pid}.parcial`;
            await fs.writeFile(tmp, dados);
            await fs.rename(tmp, destino);
        }
        const criada = await prisma.figurinha.create({
            data: { userId, arquivo: v.arquivo, hash: v.hash, animada: v.animada },
            select: { id: true },
        });
        return { ok: true, id: criada.id, nova: true, animada: v.animada };
    });
}

/** as figurinhas do usuario, as usadas por ultimo primeiro (so o que a tela precisa; nunca o caminho) */
export async function listarFigurinhasDoUsuario(userId: string): Promise<{ id: string; animada: boolean }[]> {
    const linhas = await prisma.figurinha.findMany({
        where: { userId },
        select: { id: true, animada: true, criadaEm: true, usadaEm: true },
        take: 400,
    });
    return ordenarFigurinhas(linhas).map((f) => ({ id: f.id, animada: f.animada }));
}

/** a figurinha so existe para quem e dono dela */
export function figurinhaDoUsuario(userId: string, id: string) {
    return prisma.figurinha.findFirst({ where: { id, userId }, select: { id: true, arquivo: true, animada: true } });
}

/** apaga os arquivos que nenhuma linha usa mais (chamado depois de apagar linhas) */
async function limparArquivosOrfaos(arquivos: string[]): Promise<number> {
    let apagados = 0;
    for (const arquivo of new Set(arquivos)) {
        const hash = hashDoArquivo(arquivo);
        if (!hash) continue;
        if ((await prisma.figurinha.count({ where: { hash } })) > 0) continue;
        await apagarArquivo(arquivo);
        apagados++;
    }
    return apagados;
}

/** "Remover das minhas figurinhas": apaga a linha e, se ninguem mais usa o mesmo hash, o arquivo */
export function removerFigurinhaDoUsuario(userId: string, id: string): Promise<boolean> {
    return emSerie(FILA, async () => {
        const f = await prisma.figurinha.findFirst({ where: { id, userId }, select: { id: true, arquivo: true } });
        if (!f) return false;
        await prisma.figurinha.delete({ where: { id: f.id } });
        await limparArquivosOrfaos([f.arquivo]);
        return true;
    });
}

/** marca o uso (a lista mostra as usadas por ultimo primeiro). Falha aqui nunca impede o envio. */
export async function marcarFigurinhaUsada(id: string): Promise<void> {
    await prisma.figurinha.update({ where: { id }, data: { usadaEm: new Date() } }).catch(() => {});
}

/** nomes dos arquivos do usuario, para chamar ANTES de excluir a conta (as linhas saem em cascata) */
export async function arquivosDoUsuario(userId: string): Promise<string[]> {
    const linhas = await prisma.figurinha.findMany({ where: { userId }, select: { arquivo: true } });
    return linhas.map((l) => l.arquivo);
}

/** exclusao de conta (LGPD): depois que as linhas sairam em cascata, apaga os arquivos que ficaram sem uso */
export function apagarArquivosOrfaosDe(arquivos: string[]): Promise<number> {
    if (!arquivos.length) return Promise.resolve(0);
    return emSerie(FILA, () => limparArquivosOrfaos(arquivos));
}
