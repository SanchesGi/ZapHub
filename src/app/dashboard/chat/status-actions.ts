"use server";

// minha versao: status (stories) no painel. Ver e responder exigem acesso a sessao (canAccessSession);
// PUBLICAR exige poder gerenciar a sessao (podeGerenciarSessao).
import { z } from "zod";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { podeGerenciarSessao } from "@/lib/session-access";
import { marcarAgente } from "@/lib/agente";
import { StatusService } from "@/modules/whatsapp/status.service";
import { FONTES_STATUS, validarPublicacao, validarResposta, type ListaStatusDTO } from "@/lib/status-puro";

// minha versao: erro esperado volta como dado (o Next troca a mensagem de erro lancado por React #441 em producao)
const falha = (error: string) => ({ success: false as const, error });

const chaveSessao = z.string().trim().min(1).max(191);
const idStatus = z.string().trim().min(1).max(64);

type Acesso = { erro: string } | { erro?: undefined; user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserForAction>>>; sessionId: string };

async function exigirAcesso(sessionId: unknown): Promise<Acesso> {
    const chave = chaveSessao.safeParse(sessionId);
    if (!chave.success) return { erro: "Sessão inválida." };
    const user = await getAuthenticatedUserForAction();
    if (!user) return { erro: "Unauthorized" };
    if (!(await canAccessSession(user.id, user.role, chave.data))) return { erro: "Forbidden" };
    return { user, sessionId: chave.data };
}

export async function listarStatus(sessionId: string): Promise<{ success: true; dados: ListaStatusDTO } | { success: false; error: string }> {
    const a = await exigirAcesso(sessionId);
    if (a.erro !== undefined) return falha(a.erro);
    try {
        const podePublicar = await podeGerenciarSessao(a.user.id, a.user.role, a.sessionId);
        const dados = await StatusService.listar(a.sessionId, a.user.id, podePublicar);
        if (!dados) return falha("Sessão não encontrada.");
        return { success: true, dados };
    } catch (e: any) {
        console.error("Status: erro ao listar", e);
        return falha("Não consegui carregar os status.");
    }
}

const corpoVistos = z.object({ ids: z.array(idStatus).min(1).max(100) });

export async function marcarStatusVistos(sessionId: string, ids: string[]) {
    const a = await exigirAcesso(sessionId);
    if (a.erro !== undefined) return falha(a.erro);
    const p = corpoVistos.safeParse({ ids });
    if (!p.success) return falha("Status inválido.");
    try {
        await StatusService.marcarVistos(a.sessionId, a.user.id, p.data.ids);
        return { success: true as const };
    } catch (e: any) {
        console.error("Status: erro ao marcar como visto", e);
        return falha("Não consegui marcar como visto.");
    }
}

export async function responderStatus(sessionId: string, statusId: string, texto: string) {
    const a = await exigirAcesso(sessionId);
    if (a.erro !== undefined) return falha(a.erro);
    const id = idStatus.safeParse(statusId);
    if (!id.success) return falha("Status inválido.");
    const resp = validarResposta(texto);
    if (!resp.ok) return falha(resp.erro);
    try {
        const r = await StatusService.responder(a.sessionId, id.data, resp.texto);
        marcarAgente(r, a.user.name || a.user.email).catch(() => {});
        return { success: true as const };
    } catch (e: any) {
        return falha(`Não consegui enviar: ${e?.message || "erro desconhecido"}`);
    }
}

const camposPublicacao = z.object({
    tipo: z.enum(["TEXT", "IMAGE", "VIDEO"]),
    texto: z.string().max(5000).optional(),
    legenda: z.string().max(5000).optional(),
    fundo: z.string().max(16).optional(),
    fonte: z.coerce.number().int().refine((n) => FONTES_STATUS.includes(n)).optional(), // minha versao: so as fontes que o WhatsApp tem
});

export async function publicarStatus(formData: FormData) {
    const a = await exigirAcesso(formData.get("sessionId"));
    if (a.erro !== undefined) return falha(a.erro);
    // publicar fala com todos os contatos: so quem gerencia a sessao
    if (!(await podeGerenciarSessao(a.user.id, a.user.role, a.sessionId))) return falha("Forbidden");

    const bruto = (campo: string) => {
        const v = formData.get(campo);
        return typeof v === "string" && v !== "" ? v : undefined;
    };
    const campos = camposPublicacao.safeParse({ tipo: bruto("tipo"), texto: bruto("texto"), legenda: bruto("legenda"), fundo: bruto("fundo"), fonte: bruto("fonte") });
    if (!campos.success) return falha("Dados do status inválidos.");

    const arquivo = formData.get("file");
    const file = arquivo instanceof File && arquivo.size > 0 ? arquivo : null;
    const valida = validarPublicacao({
        ...campos.data,
        arquivo: file ? { mimetype: file.type, tamanho: file.size } : null,
    });
    if (!valida.ok) return falha(valida.erro);

    try {
        const midia = file ? { buffer: Buffer.from(await file.arrayBuffer()), mimetype: file.type.split(";")[0].trim().toLowerCase() } : undefined;
        const r = await StatusService.publicar(a.sessionId, valida.dados, midia);
        return { success: true as const, ...r };
    } catch (e: any) {
        console.error("Status: erro ao publicar", e);
        return falha(`Não consegui publicar: ${e?.message || "erro desconhecido"}`);
    }
}
