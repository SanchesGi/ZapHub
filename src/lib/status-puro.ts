// minha versao: status (stories) do painel. Regras puras, sem dependencias (nem Baileys, nem banco), para testar sozinhas:
// validade de 24 h, agrupar por contato, ordenar, ler o conteudo recebido, validar a publicacao e montar a citacao.

export const STATUS_JID = "status@broadcast";
export const VALIDADE_STATUS_MS = 24 * 60 * 60 * 1000;

export type TipoStatus = "TEXT" | "IMAGE" | "VIDEO";

export const TEXTO_STATUS_MAX = 700;
export const LEGENDA_STATUS_MAX = 700;
export const RESPOSTA_STATUS_MAX = 4096;
export const IMAGEM_STATUS_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_STATUS_MAX_BYTES = 64 * 1024 * 1024;
/** teto de contatos que recebem o status publicado (o WhatsApp cifra uma copia por aparelho de cada um) */
// minha versao: 256 (antes 500) e so quem conversou nos ultimos 30 dias: lista enorme de numeros que nunca falaram com a
// conta e padrao de spam e arrisca o bloqueio do numero
export const DESTINATARIOS_STATUS_MAX = 256;
export const DIAS_CONVERSA_STATUS = 30;
/** uma publicacao por minuto por sessao */
export const INTERVALO_PUBLICACAO_MS = 60_000;

/** segundos que faltam para poder publicar de novo; 0 = liberado */
export function segundosParaPublicar(ultimaEm: number | null | undefined, agora: number = Date.now(), intervaloMs: number = INTERVALO_PUBLICACAO_MS): number {
    if (typeof ultimaEm !== "number" || !Number.isFinite(ultimaEm)) return 0;
    const falta = ultimaEm + intervaloMs - agora;
    return falta > 0 ? Math.ceil(falta / 1000) : 0;
}

/** texto do bloqueio por frequencia */
export function mensagemDeEsperaDoStatus(segundos: number): string {
    return `Aguarde ${segundos} segundo${segundos === 1 ? "" : "s"} para publicar outro status (no máximo 1 por minuto em cada sessão, para proteger o seu número).`;
}

export const MIMES_IMAGEM_STATUS = ["image/jpeg", "image/png", "image/webp"];
export const MIMES_VIDEO_STATUS = ["video/mp4", "video/3gpp"];

// cores de fundo oferecidas na publicacao de texto (o ambar da marca primeiro)
export const CORES_FUNDO_STATUS = ["#a8650a", "#f4a935", "#7a3b1d", "#3b4a2f", "#1f4e5f", "#4a3a7a", "#8a2c4a", "#2b2b2b"];
export const COR_FUNDO_PADRAO = CORES_FUNDO_STATUS[0];
const COR_HEX = /^#[0-9a-fA-F]{6}$/;
// minha versao: fontes de texto que o WhatsApp aceita no status (os outros numeros nao existem la)
export const FONTES_STATUS: readonly number[] = [0, 1, 2, 6, 7, 8, 9, 10];

export function ehJidDeStatus(jid: string | null | undefined): boolean {
    return jid === STATUS_JID;
}

type Instante = Date | string | number;
const ms = (t: Instante): number => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : new Date(t).getTime());

/** quando o status vence: 24 h depois de publicado */
export function expiraEmDe(criadoEm: Instante): Date {
    return new Date(ms(criadoEm) + VALIDADE_STATUS_MS);
}

/** vale enquanto nao vencer. Sem data de validade gravada, conta 24 h a partir da publicacao. */
export function statusVigente(s: { expiraEm?: Instante | null; criadoEm: Instante }, agora: number = Date.now()): boolean {
    const fim = s.expiraEm != null ? ms(s.expiraEm) : ms(s.criadoEm) + VALIDADE_STATUS_MS;
    return Number.isFinite(fim) && fim > agora;
}

/** cor ARGB do WhatsApp (numero de 32 bits, texto ou Long do protobuf) -> "#RRGGBB"; 0/ausente -> null */
export function argbParaHex(valor: unknown): string | null {
    let n: number;
    if (typeof valor === "number") n = valor;
    else if (typeof valor === "string" && /^-?\d{1,12}$/.test(valor.trim())) n = Number(valor.trim());
    else if (valor && typeof (valor as { toNumber?: unknown }).toNumber === "function") n = (valor as { toNumber: () => number }).toNumber();
    else return null;
    if (!Number.isFinite(n) || n === 0) return null;
    const rgb = (n >>> 0) & 0xffffff;
    return `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
}

export type ConteudoStatus = { tipo: TipoStatus; texto: string; fundo: string | null; fonte: number | null };

/**
 * Le o conteudo (ja normalizado pelo Baileys) de uma mensagem de status.
 * So texto, foto e video viram status guardado; o resto (audio, tecnicas) devolve null.
 */
export function lerConteudoDeStatus(conteudo: any): ConteudoStatus | null {
    if (!conteudo || typeof conteudo !== "object") return null;
    if (conteudo.imageMessage) return { tipo: "IMAGE", texto: String(conteudo.imageMessage.caption || ""), fundo: null, fonte: null };
    if (conteudo.videoMessage) return { tipo: "VIDEO", texto: String(conteudo.videoMessage.caption || ""), fundo: null, fonte: null };
    const ext = conteudo.extendedTextMessage;
    const texto = typeof conteudo.conversation === "string" && conteudo.conversation
        ? conteudo.conversation
        : typeof ext?.text === "string" ? ext.text : "";
    if (!texto.trim()) return null;
    const fonte = Number(ext?.font);
    return { tipo: "TEXT", texto, fundo: argbParaHex(ext?.backgroundArgb), fonte: Number.isInteger(fonte) && fonte > 0 ? fonte : null };
}

/** quanto tempo cada status fica na tela antes de passar para o proximo */
export function tempoDeExibicaoMs(tipo: TipoStatus, texto: string | null | undefined, duracaoVideoMs?: number | null): number {
    if (tipo === "VIDEO") {
        const d = Number(duracaoVideoMs);
        return Number.isFinite(d) && d > 0 ? Math.min(30_000, Math.max(3_000, Math.round(d))) : 15_000;
    }
    if (tipo === "IMAGE") return 6_000;
    return Math.min(15_000, Math.max(5_000, 4_000 + (texto || "").length * 60));
}

// ---- agrupar e ordenar ----

export type ItemStatus = {
    id: string;
    jid: string; // autor (telefone)
    nome: string;
    fromMe: boolean;
    criadoEm: Instante;
    expiraEm?: Instante | null;
    visto: boolean;
};

export type GrupoStatus<T extends ItemStatus = ItemStatus> = {
    jid: string;
    nome: string;
    fromMe: boolean;
    ultimoEm: number;
    total: number;
    naoVistos: number;
    itens: T[]; // do mais antigo para o mais novo (a ordem em que se assiste)
};

export type ListaAgrupada<T extends ItemStatus = ItemStatus> = {
    meus: GrupoStatus<T> | null;
    contatos: GrupoStatus<T>[];
    totalNaoVistos: number;
};

/**
 * Agrupa por autor so o que ainda vale. Contatos: quem tem status que voce ainda nao viu vem primeiro; dentro de cada
 * bloco, o mais recente primeiro. Os meus ficam separados ("Meu status").
 */
export function agruparStatus<T extends ItemStatus>(itens: T[], agora: number = Date.now()): ListaAgrupada<T> {
    const porAutor = new Map<string, T[]>();
    for (const it of itens) {
        if (!statusVigente(it, agora)) continue;
        const chave = it.fromMe ? "__eu__" : it.jid;
        const lista = porAutor.get(chave);
        if (lista) lista.push(it); else porAutor.set(chave, [it]);
    }
    const grupos: GrupoStatus<T>[] = [];
    for (const lista of porAutor.values()) {
        const ordenada = [...lista].sort((a, b) => ms(a.criadoEm) - ms(b.criadoEm));
        const novo = ordenada[ordenada.length - 1];
        grupos.push({
            jid: novo.jid,
            nome: novo.nome,
            fromMe: novo.fromMe,
            ultimoEm: ms(novo.criadoEm),
            total: ordenada.length,
            naoVistos: ordenada.filter((i) => !i.visto).length,
            itens: ordenada,
        });
    }
    const meus = grupos.find((g) => g.fromMe) || null;
    const contatos = grupos
        .filter((g) => !g.fromMe)
        .sort((a, b) => (a.naoVistos > 0 ? 0 : 1) - (b.naoVistos > 0 ? 0 : 1) || b.ultimoEm - a.ultimoEm);
    return { meus, contatos, totalNaoVistos: contatos.reduce((n, g) => n + g.naoVistos, 0) };
}

/** nome para mostrar: o da agenda, depois o que veio no status, depois o numero */
export function nomeDoAutor(jid: string, agenda?: string | null, doStatus?: string | null): string {
    const a = (agenda || "").trim();
    if (a) return a;
    const s = (doStatus || "").trim();
    if (s) return s;
    const numero = jid.split("@")[0].split(":")[0];
    return /^\d{8,15}$/.test(numero) && jid.endsWith("@s.whatsapp.net") ? `+${numero}` : "Contato";
}

// ---- publicar ----

export type EntradaPublicacao = {
    tipo: string;
    texto?: string | null; // texto do status de texto
    legenda?: string | null; // legenda de foto/video
    fundo?: string | null;
    fonte?: number | null;
    arquivo?: { mimetype: string; tamanho: number } | null;
};

export type PublicacaoValida = { tipo: TipoStatus; texto: string; fundo: string | null; fonte: number | null };
export type ResultadoPublicacao = { ok: true; dados: PublicacaoValida } | { ok: false; erro: string };

export function validarPublicacao(e: EntradaPublicacao): ResultadoPublicacao {
    if (e.tipo !== "TEXT" && e.tipo !== "IMAGE" && e.tipo !== "VIDEO") return { ok: false, erro: "Tipo de status inválido." };
    if (e.tipo === "TEXT") {
        const texto = (e.texto || "").trim();
        if (!texto) return { ok: false, erro: "Escreva o texto do status." };
        if (texto.length > TEXTO_STATUS_MAX) return { ok: false, erro: `O texto passa de ${TEXTO_STATUS_MAX} caracteres.` };
        const fundo = e.fundo ? e.fundo.trim() : COR_FUNDO_PADRAO;
        if (!COR_HEX.test(fundo)) return { ok: false, erro: "Cor de fundo inválida." };
        const fonte = e.fonte == null ? null : e.fonte;
        if (fonte !== null && !FONTES_STATUS.includes(fonte)) return { ok: false, erro: "Fonte inválida." };
        return { ok: true, dados: { tipo: "TEXT", texto, fundo: fundo.toLowerCase(), fonte: fonte || null } };
    }
    const arq = e.arquivo;
    if (!arq || !Number.isFinite(arq.tamanho) || arq.tamanho <= 0) return { ok: false, erro: "Escolha uma foto ou um vídeo." };
    const mime = (arq.mimetype || "").toLowerCase().split(";")[0].trim();
    const legenda = (e.legenda || "").trim();
    if (legenda.length > LEGENDA_STATUS_MAX) return { ok: false, erro: `A legenda passa de ${LEGENDA_STATUS_MAX} caracteres.` };
    if (e.tipo === "IMAGE") {
        if (!MIMES_IMAGEM_STATUS.includes(mime)) return { ok: false, erro: "A foto precisa ser JPG, PNG ou WebP." };
        if (arq.tamanho > IMAGEM_STATUS_MAX_BYTES) return { ok: false, erro: "A foto passa de 16 MB." };
    } else {
        if (!MIMES_VIDEO_STATUS.includes(mime)) return { ok: false, erro: "O vídeo precisa ser MP4 (ou 3GP)." };
        if (arq.tamanho > VIDEO_STATUS_MAX_BYTES) return { ok: false, erro: "O vídeo passa de 64 MB." };
    }
    return { ok: true, dados: { tipo: e.tipo, texto: legenda, fundo: null, fonte: null } };
}

export type ContatoParaStatus = { jid: string; name?: string | null; notify?: string | null; updatedAt?: Instante | null };

const JID_TELEFONE = /^\d{5,20}(:\d+)?@s\.whatsapp\.net$/;
const semAparelho = (jid: string) => jid.replace(/:\d+(?=@)/, "");

/**
 * Quem recebe o status publicado: so numeros de pessoas (nada de grupo, lista de transmissao, canal ou @lid sem
 * telefone), sem repetir e sem o proprio numero. Quem tem nome na agenda vem primeiro, depois os mais recentes.
 */
export function escolherDestinatarios(contatos: ContatoParaStatus[], meuJid: string | null | undefined, max: number = DESTINATARIOS_STATUS_MAX) {
    const eu = meuJid ? semAparelho(meuJid) : null;
    const vistos = new Set<string>();
    const validos: ContatoParaStatus[] = [];
    for (const c of contatos) {
        if (!c || typeof c.jid !== "string" || !JID_TELEFONE.test(c.jid)) continue;
        const jid = semAparelho(c.jid);
        if (jid === eu || vistos.has(jid)) continue;
        vistos.add(jid);
        validos.push({ ...c, jid });
    }
    validos.sort((a, b) => {
        const na = (a.name || "").trim() ? 0 : 1;
        const nb = (b.name || "").trim() ? 0 : 1;
        if (na !== nb) return na - nb;
        return (b.updatedAt ? ms(b.updatedAt) : 0) - (a.updatedAt ? ms(a.updatedAt) : 0);
    });
    const jids = validos.slice(0, Math.max(0, max)).map((c) => c.jid);
    return { jids, total: validos.length, cortado: validos.length > jids.length };
}

// ---- responder ----

export function validarResposta(texto: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
    if (typeof texto !== "string") return { ok: false, erro: "Escreva a resposta." };
    const t = texto.trim();
    if (!t) return { ok: false, erro: "Escreva a resposta." };
    if (t.length > RESPOSTA_STATUS_MAX) return { ok: false, erro: `A resposta passa de ${RESPOSTA_STATUS_MAX} caracteres.` };
    return { ok: true, texto: t };
}

/**
 * Mensagem citada para responder a um status: o WhatsApp mostra o status dentro da resposta na conversa privada.
 * Midia vai so com a legenda (sem URL nem chave): a citacao nunca leva arquivo.
 */
export function citacaoDoStatus(s: { keyId: string; autorJid: string; tipo: string; texto?: string | null }) {
    const texto = s.texto || "";
    const message = s.tipo === "IMAGE" ? { imageMessage: { caption: texto, mimetype: "image/jpeg" } }
        : s.tipo === "VIDEO" ? { videoMessage: { caption: texto, mimetype: "video/mp4" } }
        : { conversation: texto };
    return { key: { remoteJid: STATUS_JID, fromMe: false, id: s.keyId, participant: s.autorJid }, message };
}

// ---- rotulos ----

/** "agora", "há 5 min", "há 3 h" (os status duram no maximo 24 h, entao nao ha dias) */
export function tempoRelativo(desde: Instante, agora: number = Date.now()): string {
    const min = Math.floor((agora - ms(desde)) / 60_000);
    if (!Number.isFinite(min) || min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    return `há ${Math.floor(min / 60)} h`;
}

// ---- o que a tela recebe do servidor ----

/** o que a tela recebe de cada status (sem chaves de midia nem dados internos) */
export type StatusDTO = {
    id: string;
    jid: string;
    nome: string;
    fromMe: boolean;
    tipo: TipoStatus;
    texto: string | null;
    fundo: string | null;
    midiaUrl: string | null;
    midiaPendente: boolean;
    midiaFalhou: boolean;
    criadoEm: string;
    expiraEm: string;
    visto: boolean;
    duracaoMs: number;
};

export type GrupoStatusDTO = GrupoStatus<StatusDTO> & { fotoUrl: string | null };

export type ListaStatusDTO = {
    meus: GrupoStatusDTO | null;
    contatos: GrupoStatusDTO[];
    totalNaoVistos: number;
    podePublicar: boolean;
    /** quantos contatos receberiam um status publicado agora (ja com o teto) */
    destinatarios: number | null;
};

