// minha versao: LGPD — funcoes puras (sem banco, sem disco) para poderem ser testadas em qualquer lugar.

/** so os digitos do telefone */
export function normalizarTelefone(entrada: unknown): string {
    return String(entrada ?? "").replace(/\D/g, "");
}

/**
 * Numeros (so digitos, com DDI) que podem ser o mesmo titular: com e sem o 55, com e sem o 9 depois do DDD.
 * Numero que nao parece brasileiro (nem 10/11 digitos locais nem 55 + isso) so casa exatamente.
 * Devolve [] se tiver menos de 8 digitos (evita apagar "todo mundo" por um termo curto).
 */
export function variantesDoTitular(entrada: unknown): string[] {
    const d = normalizarTelefone(entrada);
    if (d.length < 8 || d.length > 15) return [];
    const v = new Set<string>([d]);
    let local: string | null = null;
    if (d.length >= 12 && d.length <= 13 && d.startsWith("55")) local = d.slice(2);
    else if (d.length === 10 || d.length === 11) local = d;
    if (local) {
        const locais = new Set<string>([local]);
        if (local.length === 11 && local[2] === "9") locais.add(local.slice(0, 2) + local.slice(3)); // sem o 9
        if (local.length === 10) locais.add(local.slice(0, 2) + "9" + local.slice(2));             // com o 9
        for (const l of locais) { v.add(l); v.add("55" + l); }
    }
    return [...v];
}

/** JIDs de conversa individual para os numeros */
export function jidsDoTitular(entrada: unknown): string[] {
    return variantesDoTitular(entrada).map((n) => `${n}@s.whatsapp.net`);
}

/** data de corte: tudo ANTES dela passou do prazo de guarda */
export function dataDeCorte(dias: number, agora: Date = new Date()): Date {
    return new Date(agora.getTime() - dias * 86_400_000);
}

export const MINIMO_RETENCAO_DIAS = 30;
export const MAXIMO_RETENCAO_DIAS = 36500;

/** null/"" = guardar para sempre; senao inteiro >= 30. Devolve undefined se o valor for invalido. */
export function lerDiasRetencao(v: unknown): number | null | undefined {
    if (v === null || v === "" || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < MINIMO_RETENCAO_DIAS || n > MAXIMO_RETENCAO_DIAS) return undefined;
    return n;
}

/** hora (0-23) no fuso informado; usa UTC se o fuso for invalido */
export function horaNoFuso(fuso: string, agora: Date = new Date()): number {
    try {
        const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: fuso }).format(agora);
        return Number(h);
    } catch {
        return agora.getUTCHours();
    }
}

/** dia (AAAA-MM-DD) no fuso informado */
export function diaNoFuso(fuso: string, agora: Date = new Date()): string {
    try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(agora);
    } catch {
        return agora.toISOString().slice(0, 10);
    }
}
