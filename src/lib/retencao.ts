// minha versao: LGPD — retencao de dados. O Super Administrador define em quantos dias apagar mensagens, midias e logs
// (null = guardar para sempre). Roda todo dia as 03:00 no fuso do sistema (ver cron.ts) e sob demanda pelo painel.
// Tudo em lotes pequenos para nao travar o banco. Nunca fala com o WhatsApp.
import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { registrarAcesso } from "./log-acesso";
import { apagarMidiasAntigas } from "./pasta-midia";
import { apagarArquivosDeMidia } from "./lgpd-midia";
import { dataDeCorte } from "./lgpd-puro";
import { logger } from "./logger";

const LOTE = 500;
const MAX_LOTES = 400; // por tabela e por execucao (200 mil linhas); o resto fica para a proxima

export type ResultadoRetencao = {
    mensagens: { apagadas: number; arquivos: number; bytes: number; parcial?: boolean } | null;
    midias: { arquivos: number; bytes: number } | null;
    logs: { logAcesso: number; auditoria: number; webhookLog: number; broadcastLog: number; notificacoes: number } | null;
    erro?: string;
    origem: "AGENDADA" | "MANUAL";
    duracaoMs: number;
};

type Estado = { ultimaExecucao: string | null; resultado: ResultadoRetencao | null; rodando: boolean; ultimoDia: string | null };
const G = globalThis as unknown as { __waRetencao?: Estado };
const estado: Estado = (G.__waRetencao ??= { ultimaExecucao: null, resultado: null, rodando: false, ultimoDia: null });

export function marcarDiaExecutado(dia: string) { estado.ultimoDia = dia; }
export function diaJaExecutado(dia: string) { return estado.ultimoDia === dia; }
export function retencaoRodando() { return estado.rodando; }

export async function lerConfigRetencao() {
    const cfg = await prisma.systemConfig.findUnique({
        where: { id: "default" },
        select: { retencaoMensagensDias: true, retencaoMidiasDias: true, retencaoLogsDias: true },
    });
    return {
        retencaoMensagensDias: cfg?.retencaoMensagensDias ?? null,
        retencaoMidiasDias: cfg?.retencaoMidiasDias ?? null,
        retencaoLogsDias: cfg?.retencaoLogsDias ?? null,
    };
}

/** ultima execucao: da memoria; apos reiniciar, do registro de seguranca (MANUTENCAO / alvo retencao) */
export async function ultimaExecucao(): Promise<{ ultimaExecucao: string | null; resultado: ResultadoRetencao | null }> {
    if (estado.ultimaExecucao) return { ultimaExecucao: estado.ultimaExecucao, resultado: estado.resultado };
    try {
        const l = await prisma.logAcesso.findFirst({ where: { tipo: "MANUTENCAO", alvo: "retencao" }, orderBy: { quando: "desc" }, select: { quando: true, detalhe: true } });
        if (l) {
            let resultado: ResultadoRetencao | null = null;
            try { resultado = l.detalhe ? JSON.parse(l.detalhe) : null; } catch { /* detalhe nao e JSON */ }
            return { ultimaExecucao: l.quando.toISOString(), resultado };
        }
    } catch { /* sem banco */ }
    return { ultimaExecucao: null, resultado: null };
}

/** apaga em lotes: busca ids antigos e apaga; para quando acabar ou atingir o limite */
async function apagarEmLotes(buscar: (take: number) => Promise<string[]>, apagar: (ids: string[]) => Promise<unknown>): Promise<{ total: number; parcial: boolean }> {
    let total = 0;
    for (let i = 0; i < MAX_LOTES; i++) {
        const ids = await buscar(LOTE);
        if (!ids.length) return { total, parcial: false };
        await apagar(ids);
        total += ids.length;
        if (ids.length < LOTE) return { total, parcial: false };
        await new Promise((r) => setTimeout(r, 20)); // respira entre lotes
    }
    return { total, parcial: true };
}

async function aplicarMensagens(dias: number) {
    const corte = dataDeCorte(dias);
    let arquivos = 0, bytes = 0;
    const r = await apagarEmLotes(
        async (take) => {
            const rows = await prisma.message.findMany({ where: { timestamp: { lt: corte } }, select: { id: true, mediaUrl: true }, take });
            // os arquivos saem ANTES das linhas
            const a = await apagarArquivosDeMidia(rows.map((x) => x.mediaUrl));
            arquivos += a.arquivos; bytes += a.bytes;
            return rows.map((x) => x.id);
        },
        (ids) => prisma.message.deleteMany({ where: { id: { in: ids } } }),
    );
    return { apagadas: r.total, arquivos, bytes, parcial: r.parcial || undefined };
}

async function aplicarMidias(dias: number) {
    const r = await apagarMidiasAntigas(dias);
    for (let i = 0; i < r.nomes.length; i += LOTE) {
        const urls = r.nomes.slice(i, i + LOTE).map((n) => `/api/media/${n}`);
        // minha versao: midia vencida perde tambem os dados de download (a chave da midia no WhatsApp)
        await prisma.$executeRaw`UPDATE \`Message\` SET mediaUrl = NULL, extra = JSON_REMOVE(extra, '$.midiaOrigem') WHERE mediaUrl IN (${Prisma.join(urls)})`;
        await prisma.auditoria.updateMany({ where: { mediaUrl: { in: urls } }, data: { mediaUrl: null } });
    }
    return { arquivos: r.apagados, bytes: r.bytes };
}

async function aplicarLogs(dias: number) {
    const corte = dataDeCorte(dias);
    const logAcesso = await apagarEmLotes(
        async (take) => (await prisma.logAcesso.findMany({ where: { quando: { lt: corte } }, select: { id: true }, take })).map((x) => x.id),
        (ids) => prisma.logAcesso.deleteMany({ where: { id: { in: ids } } }));
    const auditoria = await apagarEmLotes(
        async (take) => (await prisma.auditoria.findMany({ where: { criadoEm: { lt: corte } }, select: { id: true }, take })).map((x) => x.id),
        (ids) => prisma.auditoria.deleteMany({ where: { id: { in: ids } } }));
    const webhookLog = await apagarEmLotes(
        async (take) => (await prisma.webhookLog.findMany({ where: { createdAt: { lt: corte } }, select: { id: true }, take })).map((x) => x.id),
        (ids) => prisma.webhookLog.deleteMany({ where: { id: { in: ids } } }));
    const broadcastLog = await apagarEmLotes(
        async (take) => (await prisma.broadcastLog.findMany({ where: { startedAt: { lt: corte }, status: { not: "running" } }, select: { id: true }, take })).map((x) => x.id),
        (ids) => prisma.broadcastLog.deleteMany({ where: { id: { in: ids } } }));
    const notificacoes = await apagarEmLotes(
        async (take) => (await prisma.notification.findMany({ where: { createdAt: { lt: corte } }, select: { id: true }, take })).map((x) => x.id),
        (ids) => prisma.notification.deleteMany({ where: { id: { in: ids } } }));
    return { logAcesso: logAcesso.total, auditoria: auditoria.total, webhookLog: webhookLog.total, broadcastLog: broadcastLog.total, notificacoes: notificacoes.total };
}

/** aplica a retencao com os dias salvos no SystemConfig. Duas execucoes ao mesmo tempo nao acontecem. */
export async function executarRetencao(origem: "AGENDADA" | "MANUAL", usuario?: { id: string; email: string } | null): Promise<ResultadoRetencao> {
    if (estado.rodando) throw new Error("A limpeza já está em andamento.");
    estado.rodando = true;
    const inicio = Date.now();
    const res: ResultadoRetencao = { mensagens: null, midias: null, logs: null, origem, duracaoMs: 0 };
    try {
        const cfg = await lerConfigRetencao();
        // ordem: mensagens (apaga os arquivos delas), depois midias soltas, por fim logs
        if (cfg.retencaoMensagensDias) res.mensagens = await aplicarMensagens(cfg.retencaoMensagensDias);
        if (cfg.retencaoMidiasDias) res.midias = await aplicarMidias(cfg.retencaoMidiasDias);
        if (cfg.retencaoLogsDias) res.logs = await aplicarLogs(cfg.retencaoLogsDias);
    } catch (e: any) {
        res.erro = String(e?.message || e).slice(0, 300);
        logger.error("Retencao", "Falha na limpeza por prazo", e);
    } finally {
        estado.rodando = false;
    }
    res.duracaoMs = Date.now() - inicio;
    estado.ultimaExecucao = new Date().toISOString();
    estado.resultado = res;
    // o registro entra DEPOIS da limpeza de logs, entao sobrevive a ela
    await registrarAcesso({
        tipo: "MANUTENCAO",
        usuarioId: usuario?.id ?? null,
        usuarioEmail: usuario?.email ?? null,
        alvo: "retencao",
        detalhe: JSON.stringify(res),
    });
    return res;
}
