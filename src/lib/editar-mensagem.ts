// minha versao: regra de "editar mensagem enviada" (o WhatsApp so aceita editar texto proprio, ate 15 minutos depois
// de enviado). Funcao pura: o ChatService confere antes de mandar ao WhatsApp e a tela usa para mostrar o "Editar".

export const PRAZO_EDICAO_MS = 15 * 60 * 1000;
export const TAMANHO_MAX_EDICAO = 65536;

export type MensagemParaEditar = {
    fromMe: boolean | null | undefined;
    type: string | null | undefined;
    timestamp: Date | string | number | null | undefined;
    extra?: unknown;
};

/** null = pode editar; senao, o motivo em portugues para mostrar na tela */
export function motivoParaNaoEditar(m: MensagemParaEditar, agora = Date.now()): string | null {
    if (!m.fromMe) return "Só dá para editar mensagens enviadas por você";
    if ((m.type || "TEXT") !== "TEXT") return "Só dá para editar mensagens de texto";
    const extra = m.extra && typeof m.extra === "object" ? (m.extra as Record<string, unknown>) : {};
    if (extra.apagada) return "A mensagem foi apagada";
    const quando = m.timestamp == null ? Number.NaN : new Date(m.timestamp).getTime();
    if (Number.isNaN(quando)) return "Mensagem sem data";
    if (agora - quando > PRAZO_EDICAO_MS) return "O WhatsApp só deixa editar até 15 minutos depois de enviar";
    return null;
}

/** texto novo: sem espacos nas pontas, nao vazio, no limite */
export function textoDeEdicao(v: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
    if (typeof v !== "string") return { ok: false, erro: "Mensagem vazia" };
    const texto = v.trim();
    if (!texto) return { ok: false, erro: "Mensagem vazia" };
    if (texto.length > TAMANHO_MAX_EDICAO) return { ok: false, erro: "Mensagem grande demais" };
    return { ok: true, texto };
}
