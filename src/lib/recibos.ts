// minha versao: recibos por participante de uma mensagem ENVIADA (entregue / lida / tocada) e o resumo do
// "Info da mensagem". Regras puras, sem dependencias. Guardado em Message.extra.recibos:
//   { [jid]: { entregue?: ms, lida?: ms, tocada?: ms } }

export type Recibo = { entregue?: number; lida?: number; tocada?: number };
export type Recibos = Record<string, Recibo>;

const CAMPOS = ["entregue", "lida", "tocada"] as const;
// abaixo disto o numero esta em SEGUNDOS (o WhatsApp manda o horario em segundos); 1e11 s = ano 5138, 1e11 ms = 1973
const LIMITE_SEGUNDOS = 1e11;

/** horario do WhatsApp (segundos, Long ou string) -> milissegundos; invalido ou zero -> null */
export function paraMs(ts: unknown): number | null {
    if (ts === null || ts === undefined) return null;
    const n = Number(typeof ts === "object" ? (ts as { toString(): string }).toString() : ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n < LIMITE_SEGUNDOS ? n * 1000 : n);
}

/** le Message.extra.recibos com seguranca; descarta o que nao for numero positivo */
export function normalizarRecibos(bruto: unknown): Recibos {
    const saida: Recibos = {};
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return saida;
    for (const [jid, r] of Object.entries(bruto as Record<string, unknown>)) {
        if (!r || typeof r !== "object") continue;
        const limpo: Recibo = {};
        for (const c of CAMPOS) {
            const v = (r as Record<string, unknown>)[c];
            if (typeof v === "number" && Number.isFinite(v) && v > 0) limpo[c] = v;
        }
        if (Object.keys(limpo).length) saida[jid] = limpo;
    }
    return saida;
}

/**
 * Junta um recibo novo ao que ja existe SEM duplicar nem apagar: cada campo guarda o horario mais antigo
 * (o mesmo recibo chegando de novo nao muda nada). Devolve objetos novos; `mudou` diz se ha o que gravar.
 */
export function mesclarRecibo(atual: unknown, jid: string, parcial: Recibo): { recibos: Recibos; mudou: boolean } {
    const base = normalizarRecibos(atual);
    const antigo = base[jid] || {};
    const novo: Recibo = { ...antigo };
    for (const c of CAMPOS) {
        const v = parcial[c];
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
        novo[c] = typeof antigo[c] === "number" ? Math.min(antigo[c] as number, v) : v;
    }
    const mudou = JSON.stringify(novo) !== JSON.stringify(antigo);
    return { recibos: mudou ? { ...base, [jid]: novo } : base, mudou };
}

export type Destinatario = { jid: string; em: number | null };
export type InfoMensagem = {
    enviadaEm: number;
    entregue: boolean;
    entregueEm: number | null;
    lida: boolean;
    lidaEm: number | null;
    /** quem recebeu e ainda nao leu */
    entreguePara: Destinatario[];
    /** quem leu */
    lidaPor: Destinatario[];
};

const ORDEM_STATUS = ["FAILED", "PENDING", "SENT", "DELIVERED", "READ"];

function primeiro(valores: Array<number | undefined>): number | null {
    const v = valores.filter((x): x is number => typeof x === "number");
    return v.length ? Math.min(...v) : null;
}

/** resumo do "Info da mensagem" para uma mensagem enviada (conversa privada ou grupo) */
export function montarInfo(p: { status: string; enviadaEm: number; recibos: unknown }): InfoMensagem {
    const recibos = normalizarRecibos(p.recibos);
    const lista = Object.entries(recibos);
    const nivel = ORDEM_STATUS.indexOf(p.status);

    const lidaPor = lista
        .filter(([, r]) => r.lida || r.tocada)
        .map(([jid, r]): Destinatario => ({ jid, em: primeiro([r.lida, r.tocada]) }));
    const entreguePara = lista
        .filter(([, r]) => r.entregue && !r.lida && !r.tocada)
        .map(([jid, r]): Destinatario => ({ jid, em: r.entregue ?? null }));
    const porHora = (a: Destinatario, b: Destinatario) => (a.em ?? Infinity) - (b.em ?? Infinity);
    lidaPor.sort(porHora);
    entreguePara.sort(porHora);

    const lidaEm = primeiro(lidaPor.map((d) => d.em ?? undefined));
    // quem leu tambem recebeu: se nao ha horario de "entregue", o de "lida" e o limite
    const entregueEm = primeiro([...lista.map(([, r]) => r.entregue), lidaEm ?? undefined]);
    return {
        enviadaEm: p.enviadaEm,
        entregue: nivel >= ORDEM_STATUS.indexOf("DELIVERED") || entregueEm !== null,
        entregueEm,
        lida: nivel >= ORDEM_STATUS.indexOf("READ") || lidaEm !== null,
        lidaEm,
        entreguePara,
        lidaPor,
    };
}
