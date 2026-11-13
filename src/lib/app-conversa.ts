// minha versao: dados de uma conversa para o programa do Windows (info do contato/grupo e foto de perfil).
// Tudo vem do banco da sessao e, quando conectada, ao vivo do WhatsApp (com prazo). Nada devolve URL do WhatsApp.
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { safeFetchBuffer } from "@/lib/security";
import { cabeNoCache, numeroDoJid, tipoDeImagem } from "@/lib/app-desktop-puro";

const PRAZO_WHATSAPP_MS = 8000;
const MAX_PARTICIPANTES = 1500;

const comPrazo = <T>(p: Promise<T>, ms = PRAZO_WHATSAPP_MS): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("prazo")), ms))]);

export type InfoConversa = {
    nome: string; numero: string | null; grupo: boolean; descricao?: string;
    participantes?: { jid: string; nome: string; admin: boolean }[];
};

type NomeContato = { name?: string | null; notify?: string | null; verifiedName?: string | null };
const nomeDe = (c?: NomeContato | null) => c?.name || c?.notify || c?.verifiedName || null;

export async function infoDaConversa(sessionId: string, dbSessionId: string, jid: string): Promise<InfoConversa> {
    if (jid.endsWith("@g.us")) return infoDoGrupo(sessionId, dbSessionId, jid);
    const contato = await prisma.contact.findFirst({
        where: { sessionId: dbSessionId, OR: [{ jid }, { lid: jid }] },
        select: { jid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true },
    });
    const numero = numeroDoJid(jid) || numeroDoJid(contato?.jid) || numeroDoJid(contato?.remoteJidAlt);
    return { nome: nomeDe(contato) || numero || jid.split("@")[0], numero, grupo: false };
}

type Participante = { id?: string; jid?: string; phoneNumber?: string; admin?: string | null };

async function infoDoGrupo(sessionId: string, dbSessionId: string, jid: string): Promise<InfoConversa> {
    const gravado = await prisma.group.findFirst({ where: { sessionId: dbSessionId, jid }, select: { subject: true, description: true, participants: true } });
    let assunto = gravado?.subject || null;
    let descricao = gravado?.description || null;
    let brutos: Participante[] = Array.isArray(gravado?.participants) ? (gravado.participants as Participante[]) : [];
    const sock = waManager.getInstance(sessionId)?.socket;
    if (sock) {
        try {
            const meta = await comPrazo(sock.groupMetadata(jid));
            assunto = meta.subject || assunto;
            descricao = meta.desc ?? descricao;
            if (Array.isArray(meta.participants)) brutos = meta.participants as Participante[];
        } catch { /* sem metadados ao vivo: usa o que esta gravado */ }
    }
    brutos = brutos.filter((p) => !!p?.id).slice(0, MAX_PARTICIPANTES);
    const ids = brutos.map((p) => p.id as string);
    const alts = brutos.map((p) => p.phoneNumber || p.jid).filter((x): x is string => !!x);
    const contatos = ids.length ? await prisma.contact.findMany({
        where: { sessionId: dbSessionId, OR: [{ jid: { in: [...ids, ...alts] } }, { lid: { in: ids } }] },
        select: { jid: true, lid: true, name: true, notify: true, verifiedName: true },
    }) : [];
    const porJid = new Map(contatos.map((c) => [c.jid, c]));
    const porLid = new Map(contatos.filter((c) => c.lid).map((c) => [c.lid as string, c]));
    const participantes = brutos.map((p) => {
        const id = p.id as string;
        const alt = p.phoneNumber || p.jid || null;
        const c = porJid.get(id) || porLid.get(id) || (alt ? porJid.get(alt) : undefined);
        const numero = numeroDoJid(id) || numeroDoJid(alt) || numeroDoJid(c?.jid);
        return { jid: id, nome: nomeDe(c) || numero || id.split("@")[0], admin: !!p.admin };
    });
    return {
        nome: assunto || "Grupo", numero: null, grupo: true,
        ...(descricao ? { descricao: descricao.slice(0, 2048) } : {}),
        participantes,
    };
}

// ---- foto de perfil: o servidor busca no WhatsApp e entrega os bytes; o cliente nunca recebe a URL do CDN ----
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const PRAZO_FOTO_MS = 8000;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_FALHA_MS = 60 * 1000; // falha (sem foto, rede, URL vencida) vale so 1 minuto
const CACHE_MAX = 300;
const CACHE_MAX_BYTES = 50 * 1024 * 1024;
const HOSTS_CDN = ["whatsapp.net"]; // pps.whatsapp.net e afins; qualquer outro destino (inclusive em redirecionamento) e recusado
type Foto = { bytes: Buffer; tipo: string } | null;
const cacheFotos: Map<string, { ate: number; foto: Foto }> = ((globalThis as any).__zaphubFotos ??= new Map());

function guardarFoto(chave: string, foto: Foto) {
    cacheFotos.delete(chave);
    const tamanhos = () => [...cacheFotos.values()].map((e) => e.foto?.bytes.length ?? 0);
    const sai = Math.max(cabeNoCache(tamanhos(), foto?.bytes.length ?? 0, CACHE_MAX_BYTES), cacheFotos.size + 1 > CACHE_MAX ? 1 : 0);
    const antigas = [...cacheFotos.keys()].slice(0, sai);
    for (const k of antigas) cacheFotos.delete(k);
    cacheFotos.set(chave, { ate: Date.now() + (foto ? CACHE_MS : CACHE_FALHA_MS), foto });
}

export async function fotoDaConversa(sessionId: string, dbSessionId: string, jid: string, grande: boolean): Promise<Foto> {
    const chave = `${sessionId}|${jid}|${grande ? "g" : "p"}`;
    const guardada = cacheFotos.get(chave);
    if (guardada && guardada.ate > Date.now()) return guardada.foto;

    let foto: Foto = null;
    try {
        const sock = waManager.getInstance(sessionId)?.socket;
        let url: string | null | undefined;
        if (sock) url = await comPrazo(sock.profilePictureUrl(jid, grande ? "image" : "preview"), PRAZO_FOTO_MS).catch(() => null);
        if (!url) {
            // sem conexao ou sem foto ao vivo: tenta a URL gravada no contato (pode ja ter expirado)
            url = (await prisma.contact.findFirst({ where: { sessionId: dbSessionId, jid }, select: { profilePic: true } }))?.profilePic;
        }
        if (url) {
            // safeFetchBuffer: so https, recusa IP interno/localhost (anti-SSRF), tamanho e prazo limitados
            const r = await safeFetchBuffer(url, { maxBytes: MAX_FOTO_BYTES, timeoutMs: PRAZO_FOTO_MS, allowedHostnames: HOSTS_CDN });
            const tipo = tipoDeImagem(r.buffer);
            if (tipo) foto = { bytes: r.buffer, tipo };
        }
    } catch { /* sem foto (privacidade, URL vencida, rede): 404 */ }

    guardarFoto(chave, foto);
    return foto;
}

// minha versao: a mensagem existe NESTA sessao e NESTA conversa (inclui os outros JIDs da mesma pessoa: telefone/@lid)?
// Evita agir em id inexistente ou de outra conversa (ex.: "apagar para todos" de um id qualquer).
export async function mensagemDaConversa(dbSessionId: string, jid: string, keyId: string): Promise<boolean> {
    const jids = await ChatService.jidsDaConversa(dbSessionId, jid);
    const m = await prisma.message.findFirst({ where: { sessionId: dbSessionId, keyId, remoteJid: { in: jids } }, select: { id: true } });
    return !!m;
}

// a conversa existe nesta sessao (tem ao menos uma mensagem)?
export async function conversaExiste(dbSessionId: string, jid: string): Promise<boolean> {
    const jids = await ChatService.jidsDaConversa(dbSessionId, jid);
    return !!(await prisma.message.findFirst({ where: { sessionId: dbSessionId, remoteJid: { in: jids } }, select: { id: true } }));
}
