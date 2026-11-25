import { EMOJIS_NOVOS_DEMAIS } from "./emojis-novos";
// minha versao: logica pura dos emojis do painel do compositor (sem React, sem localStorage).
// Os DADOS vem do pacote emojibase-data (pt/compact.json: nome em portugues, palavras-chave, grupo, ordem e tons de pele),
// carregados so quando o painel abre (ver emojis-carregar.ts). Aqui ficam: montar categorias, busca, tom de pele,
// linhas da grade, recentes e inserir no cursor. Testado em __tests__/emojis.test.ts.

/** formato (so o que usamos) de cada item de emojibase-data/pt/compact.json */
export type DadoEmoji = {
    hexcode: string;
    label: string;
    unicode: string;
    group?: number;
    order?: number;
    tags?: string[];
    skins?: { hexcode: string; unicode: string }[];
};

export type ItemEmoji = {
    emoji: string;
    rotulo: string;
    /** rotulo normalizado (sem acento, minusculo) */
    rotuloBusca: string;
    /** rotulo + palavras-chave normalizados */
    busca: string;
    /** as 5 variantes de tom (indice 0 = tom 1, clara ... indice 4 = tom 5, escura); null se o emoji nao tem tom */
    tons: string[] | null;
};
export type CategoriaEmoji = { id: string; nome: string; icone: string; itens: ItemEmoji[] };

export const MAX_RECENTES = 24;
export const CHAVE_RECENTES = "zaphub.emojis.recentes";
const MAX_TAMANHO_EMOJI = 32; // sequencias com ZWJ, tom e bandeiras cabem; texto qualquer nao
export const LIMITE_BUSCA = 240;

// ---------------- tom de pele ----------------

/** 0 = amarelo (padrao), 1..5 = clara, morena clara, morena, morena escura, escura */
export type TomDePele = 0 | 1 | 2 | 3 | 4 | 5;
export const TONS_DE_PELE: readonly { valor: TomDePele; nome: string; cor: string }[] = [
    { valor: 0, nome: "Padrão (amarelo)", cor: "#F5B82E" },
    { valor: 1, nome: "Pele clara", cor: "#F9DCC4" },
    { valor: 2, nome: "Pele morena clara", cor: "#E8BE96" },
    { valor: 3, nome: "Pele morena", cor: "#C99A6B" },
    { valor: 4, nome: "Pele morena escura", cor: "#9A6A45" },
    { valor: 5, nome: "Pele escura", cor: "#5F3F2B" },
];
const MODIFICADOR_INICIAL = 0x1f3fb; // U+1F3FB (clara) .. U+1F3FF (escura)
const MODIFICADOR_FINAL = 0x1f3ff;

export function tomValido(valor: unknown): valor is TomDePele {
    return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 5;
}
/** qualquer coisa que nao seja 0..5 inteiro vira 0 (amarelo) */
export function normalizarTom(valor: unknown): TomDePele {
    return tomValido(valor) ? valor : 0;
}

/** acha, entre as variantes de um emoji, a que tem so aquele tom em todas as pessoas (ex.: casal com os dois no mesmo tom) */
export function resolverTons(skins: readonly { hexcode: string; unicode: string }[] | undefined): string[] | null {
    if (!skins?.length) return null;
    const saida: string[] = [];
    for (let i = 0; i < 5; i++) {
        const modificador = MODIFICADOR_INICIAL + i;
        const achada = skins.find((s) => {
            const mods = s.hexcode.split("-").map((h) => Number.parseInt(h, 16)).filter((n) => n >= MODIFICADOR_INICIAL && n <= MODIFICADOR_FINAL);
            return mods.length > 0 && mods.every((m) => m === modificador);
        });
        if (!achada) return null;
        saida.push(achada.unicode);
    }
    return saida;
}

/** o emoji no tom escolhido (0 ou emoji sem tom: o proprio emoji) */
export function variantePorTom(item: Pick<ItemEmoji, "emoji" | "tons">, tom: TomDePele): string {
    if (tom === 0 || !item.tons) return item.emoji;
    return item.tons[tom - 1] ?? item.emoji;
}

// Emojis das reacoes rapidas do chat: aceitam um modificador logo depois do primeiro caractere. Assim as reacoes mostram o tom
// sem precisar baixar a lista completa.
const EMOJIS_COM_TOM_SIMPLES = new Set(["👍", "🙏", "👏", "🙌", "👌", "✌️", "🤞", "💪", "🤝"]);
export function aplicarTomSimples(emoji: string, tom: TomDePele): string {
    if (tom === 0 || !EMOJIS_COM_TOM_SIMPLES.has(emoji)) return emoji;
    const pontos = Array.from(emoji.split("️").join(""));
    return pontos[0] + String.fromCodePoint(MODIFICADOR_INICIAL + tom - 1) + pontos.slice(1).join("");
}

// ---------------- categorias ----------------

// grupo do emojibase -> categoria do painel (o grupo 2, "componentes", e ignorado)
const GRUPOS: { grupo: number; id: string; nome: string; icone: string }[] = [
    { grupo: 0, id: "carinhas", nome: "Carinhas e emoção", icone: "😀" },
    { grupo: 1, id: "pessoas", nome: "Pessoas e corpo", icone: "👋" },
    { grupo: 3, id: "natureza", nome: "Animais e natureza", icone: "🐶" },
    { grupo: 4, id: "comidas", nome: "Comidas e bebidas", icone: "🍔" },
    { grupo: 5, id: "viagens", nome: "Viagens e lugares", icone: "🚗" },
    { grupo: 6, id: "atividades", nome: "Atividades", icone: "⚽" },
    { grupo: 7, id: "objetos", nome: "Objetos", icone: "💡" },
    { grupo: 8, id: "simbolos", nome: "Símbolos", icone: "❤️" },
    { grupo: 9, id: "bandeiras", nome: "Bandeiras", icone: "🏁" },
];

/** minusculas e sem acento, para "coracao" achar "coração" */
export function normalizarBusca(texto: string): string {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function paraItem(d: DadoEmoji): ItemEmoji {
    const rotuloBusca = normalizarBusca(d.label);
    const tags = (d.tags ?? []).map(normalizarBusca).join(" ");
    return { emoji: d.unicode, rotulo: d.label, rotuloBusca, busca: tags ? `${rotuloBusca} ${tags}` : rotuloBusca, tons: resolverTons(d.skins) };
}

/** agrupa os dados do emojibase nas categorias do painel, na ordem oficial de cada grupo */
export function montarCategorias(dados: readonly DadoEmoji[]): CategoriaEmoji[] {
    return GRUPOS.map((g) => ({
        id: g.id,
        nome: g.nome,
        icone: g.icone,
        itens: dados
            .filter((d) => d.group === g.grupo && d.unicode && !EMOJIS_NOVOS_DEMAIS.has(d.hexcode)) // minha versao: sem os que o Windows nao desenha
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(paraItem),
    })).filter((c) => c.itens.length > 0);
}

/**
 * emojis cujo nome ou palavras-chave tem TODAS as palavras da busca (cada uma como pedaco de palavra).
 * Quem tem a busca no proprio nome vem antes de quem so tem nas palavras-chave.
 */
export function buscarEmojis(termo: string, categorias: readonly CategoriaEmoji[], limite = LIMITE_BUSCA): ItemEmoji[] {
    const palavrasBusca = normalizarBusca(termo).split(/\s+/).filter(Boolean);
    if (!palavrasBusca.length) return [];
    const noNome: ItemEmoji[] = [];
    const nasPalavras: ItemEmoji[] = [];
    const vistos = new Set<string>();
    for (const cat of categorias) {
        for (const item of cat.itens) {
            if (vistos.has(item.emoji) || !palavrasBusca.every((p) => item.busca.includes(p))) continue;
            vistos.add(item.emoji);
            (palavrasBusca.every((p) => item.rotuloBusca.includes(p)) ? noNome : nasPalavras).push(item);
        }
    }
    return [...noNome, ...nasPalavras].slice(0, limite);
}

// ---------------- linhas da grade ----------------

export type LinhaPainel =
    | { tipo: "titulo"; id: string; nome: string }
    | { tipo: "emojis"; id: string; itens: { emoji: string; rotulo: string }[] };

/**
 * lista plana de linhas (titulo de categoria + linhas de `colunas` emojis) para a lista virtualizada.
 * `indices[id]` e a posicao do titulo de cada categoria (para rolar ate ela). Os emojis ja saem no tom escolhido.
 */
export function montarLinhas(categorias: readonly CategoriaEmoji[], recentes: readonly string[], tom: TomDePele, colunas: number): { linhas: LinhaPainel[]; indices: Record<string, number> } {
    const linhas: LinhaPainel[] = [];
    const indices: Record<string, number> = {};
    const empilhar = (id: string, nome: string, itens: { emoji: string; rotulo: string }[]) => {
        indices[id] = linhas.length;
        linhas.push({ tipo: "titulo", id, nome });
        for (let i = 0; i < itens.length; i += colunas) linhas.push({ tipo: "emojis", id, itens: itens.slice(i, i + colunas) });
    };
    if (recentes.length) empilhar("recentes", "Recentes", recentes.map((emoji) => ({ emoji, rotulo: "" })));
    for (const c of categorias) empilhar(c.id, c.nome, c.itens.map((i) => ({ emoji: variantePorTom(i, tom), rotulo: i.rotulo })));
    return { linhas, indices };
}

// ---------------- recentes ----------------

/** o mais novo vai para o inicio, sem repetir, no maximo `max`. Guarda o emoji ja com o tom escolhido. */
export function adicionarRecente(recentes: readonly string[], emoji: string, max = MAX_RECENTES): string[] {
    if (!emoji || emoji.length > MAX_TAMANHO_EMOJI) return recentes.slice(0, max);
    return [emoji, ...recentes.filter((e) => e !== emoji)].slice(0, max);
}

/** le o que esta guardado (texto JSON); qualquer coisa estranha vira lista vazia ou e descartada */
export function lerRecentes(bruto: string | null | undefined, max = MAX_RECENTES): string[] {
    if (!bruto) return [];
    let dados: unknown;
    try { dados = JSON.parse(bruto); } catch { return []; }
    if (!Array.isArray(dados)) return [];
    const saida: string[] = [];
    for (const e of dados) {
        if (typeof e === "string" && e && e.length <= MAX_TAMANHO_EMOJI && !saida.includes(e)) saida.push(e);
        if (saida.length >= max) break;
    }
    return saida;
}

export function serializarRecentes(recentes: readonly string[], max = MAX_RECENTES): string {
    return JSON.stringify(recentes.slice(0, max));
}

/** insere `texto` no lugar da selecao (ou do cursor) e diz onde o cursor deve ficar */
export function inserirNoCursor(valor: string, inicio: number | null | undefined, fim: number | null | undefined, texto: string): { valor: string; cursor: number } {
    const a = Math.min(Math.max(Number.isFinite(inicio) ? Number(inicio) : valor.length, 0), valor.length);
    const b = Math.min(Math.max(Number.isFinite(fim) ? Number(fim) : a, a), valor.length);
    return { valor: valor.slice(0, a) + texto + valor.slice(b), cursor: a + texto.length };
}
