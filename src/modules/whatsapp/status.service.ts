// minha versao: regras de servidor dos status (stories): listar, marcar como visto, responder e publicar.
// As permissoes (ver/responder = acesso a sessao; publicar = gerenciar a sessao) sao conferidas em
// src/app/dashboard/chat/status-actions.ts, antes de chamar este servico.
import { generateMessageIDV2 } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { tratarStatus, limparStatusVencidos } from "@/modules/whatsapp/store/status";
import { guardarMidiaEnviada } from "@/lib/midia-fila";
import { logger } from "@/lib/logger";
import {
    DIAS_CONVERSA_STATUS, STATUS_JID, VALIDADE_STATUS_MS, agruparStatus, citacaoDoStatus, escolherDestinatarios,
    mensagemDeEsperaDoStatus, nomeDoAutor, segundosParaPublicar, statusVigente, tempoDeExibicaoMs, type GrupoStatusDTO, type ListaAgrupada, type ListaStatusDTO, type PublicacaoValida,
    type StatusDTO, type TipoStatus,
} from "@/lib/status-puro";

const MAX_STATUS_NA_LISTA = 500;
const MAX_CONVERSAS_LIDAS = 2000;

// minha versao: ultima publicacao de cada sessao (memoria; sobrevive ao hot reload do Next)
const ultimaPublicacao: Map<string, number> = ((globalThis as any).__waUltimoStatus ??= new Map<string, number>());

const tipoValido = (t: string): TipoStatus => (t === "IMAGE" || t === "VIDEO" ? t : "TEXT");

async function sessaoPorChave(sessionKey: string) {
    return prisma.session.findUnique({ where: { sessionId: sessionKey }, select: { id: true } });
}

/**
 * minha versao: quem recebe o status = so quem ESCREVEU para esta sessao nos ultimos 30 dias (mais recentes primeiro),
 * so numeros de telefone, ate 256. Antes saia de toda a tabela Contact (qualquer numero que ja apareceu), o que
 * espalha o status para desconhecidos e arrisca a conta.
 */
async function destinatariosDaSessao(dbSessionId: string, meuJid: string | null) {
    const desde = new Date(Date.now() - DIAS_CONVERSA_STATUS * 24 * 60 * 60 * 1000);
    const conversas = await prisma.message.groupBy({
        by: ["remoteJid"],
        where: { sessionId: dbSessionId, fromMe: false, timestamp: { gte: desde }, remoteJid: { endsWith: "@s.whatsapp.net" } },
        _max: { timestamp: true },
        orderBy: { _max: { timestamp: "desc" } },
        take: MAX_CONVERSAS_LIDAS,
    });
    return escolherDestinatarios(conversas.map((c) => ({ jid: c.remoteJid, updatedAt: c._max.timestamp })), meuJid);
}

export class StatusService {
    /** status vigentes da sessao, agrupados por contato, com o "visto" deste usuario do painel */
    static async listar(sessionKey: string, userId: string, podePublicar: boolean): Promise<ListaStatusDTO | null> {
        const sessao = await sessaoPorChave(sessionKey);
        if (!sessao) return null;

        // limpeza leve: quem lista tambem apaga o que venceu (alem da rotina periodica)
        limparStatusVencidos(sessao.id).catch((e) => logger.warn("Status", `Limpeza dos vencidos falhou: ${e?.message || e}`));

        const agora = Date.now();
        const rows = await prisma.story.findMany({
            where: {
                sessionId: sessao.id,
                OR: [{ expiraEm: { gt: new Date(agora) } }, { expiraEm: null, timestamp: { gt: new Date(agora - VALIDADE_STATUS_MS) } }],
            },
            select: {
                id: true, jid: true, type: true, content: true, fundo: true, mediaUrl: true, timestamp: true, expiraEm: true,
                autorNome: true, fromMe: true, extra: true, vistos: { where: { userId }, select: { id: true } },
            },
            orderBy: { timestamp: "desc" },
            take: MAX_STATUS_NA_LISTA,
        });

        const autores = [...new Set(rows.filter((r) => !r.fromMe).map((r) => r.jid))];
        const contatos = autores.length
            ? await prisma.contact.findMany({ where: { sessionId: sessao.id, jid: { in: autores } }, select: { jid: true, name: true, notify: true, profilePic: true } })
            : [];
        const agenda = new Map(contatos.map((c) => [c.jid, c]));

        const itens: StatusDTO[] = rows.map((r) => {
            const c = agenda.get(r.jid);
            const tipo = tipoValido(r.type);
            const pendente: any = (r.extra as any)?.midiaPendente;
            return {
                id: r.id,
                jid: r.jid,
                nome: r.fromMe ? "Meu status" : nomeDoAutor(r.jid, c?.name || c?.notify, r.autorNome),
                fromMe: r.fromMe,
                tipo,
                texto: r.content,
                fundo: r.fundo,
                midiaUrl: r.mediaUrl,
                midiaPendente: tipo !== "TEXT" && !r.mediaUrl && !pendente?.falhou,
                midiaFalhou: tipo !== "TEXT" && !r.mediaUrl && !!pendente?.falhou,
                criadoEm: r.timestamp.toISOString(),
                expiraEm: (r.expiraEm ?? new Date(r.timestamp.getTime() + VALIDADE_STATUS_MS)).toISOString(),
                visto: r.fromMe || r.vistos.length > 0, // o que eu mesmo publiquei nao conta como "nao visto"
                duracaoMs: tempoDeExibicaoMs(tipo, r.content),
            };
        });

        const agrupado = agruparStatus(itens, agora);
        const comFoto = (g: ListaAgrupada<StatusDTO>["contatos"][number]): GrupoStatusDTO => ({ ...g, fotoUrl: agenda.get(g.jid)?.profilePic || null });
        let destinatarios: number | null = null;
        if (podePublicar) {
            const meuJid = waManager.getInstance(sessionKey)?.socket?.user?.id || null;
            destinatarios = (await destinatariosDaSessao(sessao.id, meuJid)).jids.length;
        }
        return {
            meus: agrupado.meus ? comFoto(agrupado.meus) : null,
            contatos: agrupado.contatos.map(comFoto),
            totalNaoVistos: agrupado.totalNaoVistos,
            podePublicar,
            destinatarios,
        };
    }

    /**
     * Marca como visto PARA ESTE USUARIO DO PAINEL. De proposito nao avisa o WhatsApp (sem recibo de leitura): o numero
     * e usado por varias pessoas e o autor nao deve ser avisado a cada atendente que abrir o status.
     */
    static async marcarVistos(sessionKey: string, userId: string, ids: string[]): Promise<number> {
        const sessao = await sessaoPorChave(sessionKey);
        if (!sessao || !ids.length) return 0;
        const validos = await prisma.story.findMany({ where: { id: { in: ids }, sessionId: sessao.id, fromMe: false }, select: { id: true } });
        if (!validos.length) return 0;
        const r = await prisma.storyVisto.createMany({ data: validos.map((s) => ({ storyId: s.id, userId })), skipDuplicates: true });
        return r.count;
    }

    /** responde ao status na conversa privada do autor, citando o status (como o WhatsApp faz) */
    static async responder(sessionKey: string, storyId: string, texto: string) {
        const sessao = await sessaoPorChave(sessionKey);
        if (!sessao) throw new Error("Sessão não encontrada.");
        const story = await prisma.story.findFirst({
            where: { id: storyId, sessionId: sessao.id },
            select: { jid: true, keyId: true, type: true, content: true, fromMe: true, timestamp: true, expiraEm: true },
        });
        if (!story || !story.keyId || !statusVigente({ criadoEm: story.timestamp, expiraEm: story.expiraEm })) throw new Error("Este status não está mais disponível.");
        if (story.fromMe) throw new Error("Não dá para responder ao seu próprio status.");
        const citacao = citacaoDoStatus({ keyId: story.keyId, autorJid: story.jid, tipo: story.type, texto: story.content });
        // mesmo envio da conversa (mesmas regras de midia, fila anti-spam e webhook)
        return ChatService.sendTextMessage(sessionKey, story.jid, { text: texto }, undefined, undefined, citacao);
    }

    /** publica o status para os contatos da sessao. `arquivo` so para foto/video. */
    static async publicar(sessionKey: string, dados: PublicacaoValida, arquivo?: { buffer: Buffer; mimetype: string }) {
        const sessao = await sessaoPorChave(sessionKey);
        if (!sessao) throw new Error("Sessão não encontrada.");
        const instance = waManager.getInstance(sessionKey);
        const sock = instance?.socket;
        if (!sock) throw new Error("O WhatsApp desta sessão não está conectado.");

        // limite de frequencia: 1 publicacao por minuto por sessao
        const espera = segundosParaPublicar(ultimaPublicacao.get(sessionKey));
        if (espera > 0) throw new Error(mensagemDeEsperaDoStatus(espera));

        const meuJid = (sock.user?.id || "").replace(/:\d+(?=@)/, "");
        const dest = await destinatariosDaSessao(sessao.id, meuJid);
        if (!dest.jids.length) throw new Error(`Nenhum contato conversou com você nos últimos ${DIAS_CONVERSA_STATUS} dias, então não há para quem publicar o status.`);
        // reserva a vaga ja (clique duplo ou duas abas nao publicam duas vezes); se o envio falhar, devolve
        const reservadoEm = Date.now();
        ultimaPublicacao.set(sessionKey, reservadoEm);

        const messageId = generateMessageIDV2(sock.user?.id);
        let conteudo: any;
        if (dados.tipo === "TEXT") {
            // linkPreview nulo: o Baileys nao busca a pagina do link no servidor
            conteudo = { text: dados.texto, linkPreview: null };
        } else {
            if (!arquivo) throw new Error("Escolha uma foto ou um vídeo.");
            // arquivo SEMPRE como Buffer (nunca URL); o filtro de midia segura ainda confere tudo em sock.sendMessage
            conteudo = dados.tipo === "IMAGE"
                ? { image: arquivo.buffer, mimetype: arquivo.mimetype, ...(dados.texto ? { caption: dados.texto } : {}) }
                : { video: arquivo.buffer, mimetype: arquivo.mimetype, ...(dados.texto ? { caption: dados.texto } : {}) };
            guardarMidiaEnviada(messageId, arquivo.buffer, arquivo.mimetype); // o status gravado usa este arquivo, sem baixar de volta
        }

        const opcoes: Record<string, unknown> = { messageId, statusJidList: meuJid ? [...dest.jids, meuJid] : dest.jids };
        if (dados.tipo === "TEXT") {
            if (dados.fundo) opcoes.backgroundColor = dados.fundo;
            if (dados.fonte) opcoes.font = dados.fonte;
        }
        let enviado;
        try {
            enviado = await sock.sendMessage(STATUS_JID, conteudo, opcoes as any);
        } catch (e) {
            if (ultimaPublicacao.get(sessionKey) === reservadoEm) ultimaPublicacao.delete(sessionKey);
            throw e;
        }

        // grava ja (o mesmo status tambem volta pelo evento do Baileys; o id impede gravar duas vezes)
        let id: string | null = null;
        if (enviado) {
            id = await tratarStatus({ msg: enviado, dbSessionId: sessao.id, sessionId: sessionKey, sock, io: (globalThis as any).io, aoVivo: true });
        }
        return { enviadoPara: dest.jids.length, cortado: dest.cortado, totalContatos: dest.total, id };
    }
}
