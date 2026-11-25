"use server";

// minha versao: colecao de figurinhas de cada atendente (painel de emojis > Figurinhas, "Adicionar as figurinhas").
// Erro esperado volta como { success: false, error } (o Next esconde erros lancados, React #441).
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { marcarAgente } from "@/lib/agente";
import { logger } from "@/lib/logger";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { autorizarMidia } from "@/lib/autorizar-midia";
import { localizarMidia, nomeDoMediaUrl } from "@/lib/pasta-midia";
import { MAX_BYTES_FIGURINHA } from "@/lib/figurinha-puro";
import {
    figurinhaDoUsuario, lerArquivoFigurinha, listarFigurinhasDoUsuario, marcarFigurinhaUsada,
    removerFigurinhaDoUsuario, salvarFigurinhaDoUsuario,
} from "@/lib/figurinhas";

const falha = (error: string) => ({ success: false as const, error });
const JID_VALIDO = /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/;

export async function listarFigurinhas() {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    try {
        return { success: true as const, itens: await listarFigurinhasDoUsuario(user.id) };
    } catch (e: any) {
        logger.error("Figurinhas", "Não consegui carregar as figurinhas", e); // minha versao: detalhe so no log (pode ter caminho do disco)
        return falha("Não consegui carregar as figurinhas. Tente de novo.");
    }
}

// "Adicionar as figurinhas": copia o arquivo da figurinha de uma mensagem da conversa para a colecao de quem clicou
export async function salvarFigurinha(sessionId: string, keyId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) return falha("Forbidden");
    if (typeof keyId !== "string" || keyId.length < 1 || keyId.length > 64) return falha("Mensagem inválida");
    try {
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return falha("Session not found");
        const msg = await prisma.message.findFirst({ where: { sessionId: session.id, keyId }, select: { type: true, mediaUrl: true } });
        if (!msg || msg.type !== "STICKER") return falha("Essa mensagem não é uma figurinha.");
        const nome = nomeDoMediaUrl(msg.mediaUrl);
        if (!nome) return falha("A figurinha ainda está baixando. Tente de novo em instantes.");
        // mesma autorizacao de midia da tela (quem ve a midia da sessao); o arquivo vem do registro da mensagem
        if (!(await autorizarMidia(user, nome, "ver"))) return falha("Forbidden");
        const caminho = await localizarMidia(nome);
        if (!caminho) return falha("O arquivo da figurinha não está mais no servidor.");
        if ((await fs.stat(caminho)).size > MAX_BYTES_FIGURINHA) return falha("A figurinha passa de 1 MB.");
        const r = await salvarFigurinhaDoUsuario(user.id, await fs.readFile(caminho));
        if (!r.ok) return falha(r.erro);
        return { success: true as const, nova: r.nova };
    } catch (e: any) {
        logger.error("Figurinhas", "Não consegui adicionar a figurinha", e); // minha versao: detalhe so no log (pode ter caminho do disco)
        return falha("Não consegui adicionar a figurinha. Tente de novo.");
    }
}

// clicar numa figurinha da grade envia na hora para a conversa aberta
export async function enviarFigurinha(sessionId: string, jid: string, figurinhaId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    if (!(await canAccessSession(user.id, user.role, sessionId))) return falha("Forbidden");
    if (typeof jid !== "string" || !JID_VALIDO.test(jid)) return falha("Conversa inválida");
    if (typeof figurinhaId !== "string" || figurinhaId.length > 64) return falha("Figurinha inválida");
    try {
        const f = await figurinhaDoUsuario(user.id, figurinhaId); // so as dele
        if (!f) return falha("Figurinha não encontrada");
        const dados = await lerArquivoFigurinha(f.arquivo);
        if (!dados) return falha("O arquivo da figurinha não está mais no servidor. Remova e adicione de novo.");
        // o envio passa pelo ChatService (sock.sendMessage do projeto, que aplica o filtro de midia): vai como Buffer
        const r = await ChatService.sendMediaMessage(sessionId, jid, dados, "sticker-pronto", "image/webp", "figurinha.webp", "", { animada: f.animada });
        marcarAgente(r, user.name || user.email).catch(() => {});
        await marcarFigurinhaUsada(f.id);
        return { success: true as const };
    } catch (e: any) {
        logger.error("Figurinhas", "Não consegui enviar a figurinha", e); // minha versao: detalhe so no log (pode ter caminho do disco)
        return falha("Não consegui enviar a figurinha. Tente de novo.");
    }
}

export async function removerFigurinha(figurinhaId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) return falha("Unauthorized");
    if (typeof figurinhaId !== "string" || figurinhaId.length > 64) return falha("Figurinha inválida");
    try {
        const ok = await removerFigurinhaDoUsuario(user.id, figurinhaId);
        return ok ? { success: true as const } : falha("Figurinha não encontrada");
    } catch (e: any) {
        logger.error("Figurinhas", "Não consegui remover a figurinha", e); // minha versao: detalhe so no log (pode ter caminho do disco)
        return falha("Não consegui remover a figurinha. Tente de novo.");
    }
}
