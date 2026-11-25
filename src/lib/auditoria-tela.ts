// minha versao: logica PURA da tela de Auditoria (sem banco, sem React): frases dos cartoes, agrupar por dia,
// juntar as paginas de mensagens e de conversas apagadas, e calcular o inicio do periodo.
// Fica separada para ser testada com node:test e usada igual pela API e pela tela.

export const PERIODOS = ["hoje", "7d", "30d", "tudo"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const TIPOS_FILTRO = ["PAINEL", "CELULAR", "CONTATO", "CONVERSA"] as const;
export type TipoFiltro = (typeof TIPOS_FILTRO)[number];

export const ACAO_MENSAGEM = "MENSAGEM_APAGADA";
export const ACAO_CONVERSA = "CONVERSA_APAGADA";

const DIA_MS = 86_400_000;
const MIN_MS = 60_000;

export const ehPeriodo = (v: unknown): v is Periodo => typeof v === "string" && (PERIODOS as readonly string[]).includes(v);
export const ehTipoFiltro = (v: unknown): v is TipoFiltro => typeof v === "string" && (TIPOS_FILTRO as readonly string[]).includes(v);

/**
 * Inicio do periodo (ou null = sem limite). `fusoMin` e o `Date.getTimezoneOffset()` de quem esta olhando
 * (minutos que faltam para chegar ao UTC; Brasilia = 180), para "Hoje" comecar na meia-noite DELE.
 * "7 dias" e "30 dias" contam para tras a partir de agora.
 */
export function inicioDoPeriodo(periodo: Periodo, agora: Date, fusoMin = 0): Date | null {
    if (periodo === "tudo") return null;
    if (periodo === "7d") return new Date(agora.getTime() - 7 * DIA_MS);
    if (periodo === "30d") return new Date(agora.getTime() - 30 * DIA_MS);
    const deslocamento = fusoMin * MIN_MS;
    const diaLocal = Math.floor((agora.getTime() - deslocamento) / DIA_MS);
    return new Date(diaLocal * DIA_MS + deslocamento);
}

/** Pedaco do `where` do Prisma para cada "Tipo" do filtro. */
export function condicaoDoTipo(tipo: TipoFiltro): { origem?: string; acao?: string } {
    switch (tipo) {
        case "PAINEL": return { origem: "PAINEL", acao: ACAO_MENSAGEM };
        case "CONTATO": return { origem: "CONTATO", acao: ACAO_MENSAGEM };
        case "CELULAR": return { origem: "CELULAR", acao: ACAO_MENSAGEM };
        case "CONVERSA": return { acao: ACAO_CONVERSA };
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Frases dos cartoes

export type RegistroTela = {
    acao?: string | null;
    origem: string;
    modo: string | null;
    usuarioNome: string | null;
    chatJid: string;
    chatNome: string | null;
    autorNome?: string | null;
    fromMe?: boolean;
    sessaoNome?: string | null;
    sessaoDono?: string | null;
    criadoEm: string;
};

/** +55 (46) 9999-9999 para numeros do Brasil; +numero para os outros; null se o jid nao for de telefone. */
export function telefoneBonito(jid?: string | null): string | null {
    if (!jid?.endsWith("@s.whatsapp.net")) return null;
    const d = jid.split("@")[0];
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
        const resto = d.slice(4);
        return `+55 (${d.slice(2, 4)}) ${resto.slice(0, -4)}-${resto.slice(-4)}`;
    }
    return "+" + d;
}

const ehGrupo = (jid: string) => jid.endsWith("@g.us");

/** Nome para mostrar da conversa: nome salvo, senao o telefone, senao um texto neutro. */
export function nomeDaConversa(r: Pick<RegistroTela, "chatJid" | "chatNome">): string {
    return r.chatNome || telefoneBonito(r.chatJid) || (ehGrupo(r.chatJid) ? "um grupo" : "um contato");
}

/** "Maria (atendente)" ou o texto neutro quando o nome nao foi guardado. */
const quem = (nome: string | null | undefined, neutro: string) => nome?.trim() || neutro;

/** Frase do topo do cartao de UMA mensagem apagada (sem a hora). */
export function fraseDoRegistro(r: Pick<RegistroTela, "origem" | "modo" | "usuarioNome">): string {
    const nome = quem(r.usuarioNome, "Alguém");
    if (r.origem === "CONTATO") return r.usuarioNome?.trim() ? `O contato ${nome} apagou para todos` : "O contato apagou para todos";
    if (r.origem === "CELULAR") {
        return r.modo === "PARA_MIM"
            ? "Este número apagou só para si, pelo celular — a mensagem sumiu do painel"
            : "Este número apagou para todos, pelo celular";
    }
    // PAINEL (e qualquer registro antigo sem origem conhecida)
    if (r.modo === "PARA_MIM") return `${nome} apagou só para este número, pelo painel`;
    if (r.modo === "TODOS") return `${nome} apagou para todos, pelo painel`;
    return `${nome} apagou, pelo painel`;
}

/** Frase do topo do cartao de uma CONVERSA apagada ("A conversa com X foi apagada pelo celular (N mensagens)"). */
export function fraseDaConversa(r: Pick<RegistroTela, "chatJid" | "chatNome">, total: number): string {
    const o = ehGrupo(r.chatJid) ? "O grupo" : "A conversa com";
    const nome = nomeDaConversa(r);
    const base = ehGrupo(r.chatJid) ? `${o} ${nome} foi apagado pelo celular` : `${o} ${nome} foi apagada pelo celular`;
    return `${base} (${total} ${total === 1 ? "mensagem" : "mensagens"})`;
}

/** Linha de baixo do cartao: "Conversa com João Silva (+55 ...), na sessão Suporte". */
export function linhaDaConversa(r: Pick<RegistroTela, "chatJid" | "chatNome" | "sessaoNome" | "sessaoDono">): string {
    const fone = telefoneBonito(r.chatJid);
    const nome = nomeDaConversa(r);
    let quemE = `Grupo ${nome}`;
    if (!ehGrupo(r.chatJid)) {
        const comFone = fone && fone !== nome ? " (" + fone + ")" : "";
        quemE = "Conversa com " + nome + comFone;
    }
    if (!r.sessaoNome) return quemE;
    const dono = r.sessaoDono ? " de " + r.sessaoDono : "";
    return `${quemE}, na sessão ${r.sessaoNome}${dono}`;
}

/** Legenda da caixa da mensagem: "escrita por João" / "escrita por este número" / "escrita por Maria, pelo ZapHub". */
export function escritaPor(r: Pick<RegistroTela, "fromMe" | "autorNome">): string {
    const nome = (r.autorNome || "").trim();
    if (r.fromMe) {
        const m = /^Você · (.+)$/.exec(nome);
        return m ? `escrita por ${m[1]}, pelo ZapHub` : "escrita por este número";
    }
    return nome ? `escrita por ${nome}` : "autor não identificado";
}

// ---------------------------------------------------------------------------------------------------------------
// Datas

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Data/hora de parede de quem olha (UTC deslocado pelo fuso), para formatar sem depender do fuso desta maquina. */
function paredeLocal(iso: string, fusoMin: number): Date | null {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t - fusoMin * MIN_MS);
}

/** "14:32" */
export function horaCurta(iso: string, fusoMin = 0): string {
    const d = paredeLocal(iso, fusoMin);
    return d ? `${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}` : "—";
}

/** "25/11/2026" */
export function dataCurta(iso: string, fusoMin = 0): string {
    const d = paredeLocal(iso, fusoMin);
    return d ? `${doisDigitos(d.getUTCDate())}/${doisDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : "—";
}

const numeroDoDia = (iso: string, fusoMin: number): number | null => {
    const d = paredeLocal(iso, fusoMin);
    return d ? Math.floor(d.getTime() / DIA_MS) : null;
};

/** "Hoje", "Ontem" ou "25/11/2026". */
export function rotuloDoDia(iso: string, agora: Date, fusoMin = 0): string {
    const dia = numeroDoDia(iso, fusoMin);
    const hoje = Math.floor((agora.getTime() - fusoMin * MIN_MS) / DIA_MS);
    if (dia === null) return "Sem data";
    if (dia === hoje) return "Hoje";
    if (dia === hoje - 1) return "Ontem";
    return dataCurta(iso, fusoMin);
}

export type GrupoDeDia<T> = { chave: string; rotulo: string; itens: T[] };

/** Agrupa (mantendo a ordem recebida) os itens que caem no mesmo dia. */
export function agruparPorDia<T extends { criadoEm: string }>(itens: T[], agora: Date, fusoMin = 0): GrupoDeDia<T>[] {
    const grupos: GrupoDeDia<T>[] = [];
    for (const item of itens) {
        const chave = String(numeroDoDia(item.criadoEm, fusoMin) ?? "sem-data");
        const ultimo = grupos.at(-1);
        if (ultimo?.chave === chave) ultimo.itens.push(item);
        else grupos.push({ chave, rotulo: rotuloDoDia(item.criadoEm, agora, fusoMin), itens: [item] });
    }
    return grupos;
}

/** Data ISO valida (com ano de 4 digitos) ou null. Usada nos parametros da API. */
export function lerDataIso(valor: unknown): Date | null {
    if (typeof valor !== "string" || valor.length < 10 || valor.length > 40) return null;
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(valor)) return null;
    const t = Date.parse(valor);
    return Number.isNaN(t) ? null : new Date(t);
}

// ---------------------------------------------------------------------------------------------------------------
// Conversas apagadas (varias linhas da Auditoria viram um cartao so)

/** Um grupo = as linhas CONVERSA_APAGADA de uma sessao + conversa gravadas no mesmo instante. */
export type GrupoConversa = { sessionId: string; chatJid: string; criadoEm: Date | string; total: number };

export const chaveDoGrupo = (g: { sessionId: string; chatJid: string; criadoEm: Date | string }) =>
    `${g.sessionId}|${g.chatJid}|${new Date(g.criadoEm).toISOString()}`;

/**
 * Junta, em ordem da mais nova para a mais antiga, uma pagina de mensagens soltas com os cartoes de conversa
 * apagada. `soltas` traz as `pagina * limite` mais novas (ja ordenadas); `grupos` traz todos os grupos.
 */
export function mesclarPagina<A extends { criadoEm: Date | string }, B extends { criadoEm: Date | string }>(
    soltas: A[], grupos: B[], pagina: number, limite: number,
): ({ tipo: "mensagem"; item: A } | { tipo: "conversa"; item: B })[] {
    const todos = [
        ...soltas.map((item) => ({ tipo: "mensagem" as const, item })),
        ...grupos.map((item) => ({ tipo: "conversa" as const, item })),
    ];
    const tempo = (x: { item: { criadoEm: Date | string } }) => new Date(x.item.criadoEm).getTime();
    todos.sort((a, b) => tempo(b) - tempo(a));
    const inicio = (Math.max(1, pagina) - 1) * limite;
    return todos.slice(inicio, inicio + limite);
}
