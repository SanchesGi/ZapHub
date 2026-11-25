// minha versao: regras puras da ENQUETE (sem dependencias: serve ao servidor e a tela).
// Validar o que o usuario digitou, montar o placar e aplicar um voto sem mexer no objeto original.

export const MIN_OPCOES = 2;
export const MAX_OPCOES = 12;
export const MAX_PERGUNTA = 255;
export const MAX_OPCAO = 100; // limite do WhatsApp para cada opcao

/** estrutura gravada em Message.extra.enquete */
export type Enquete = {
    nome: string;
    opcoes: string[];
    multipla: boolean;
    /** { opcao: jids de quem votou nela } */
    votos?: Record<string, string[]>;
};

export type ResultadoValidacao =
    | { ok: true; pergunta: string; opcoes: string[]; multipla: boolean; selectableCount: number }
    | { ok: false; erro: string };

/** confere a enquete digitada: pergunta ate 255, de 2 a 12 opcoes (ate 100 letras cada), sem repetidas */
export function validarEnquete(entrada: { pergunta?: unknown; opcoes?: unknown; multipla?: unknown }): ResultadoValidacao {
    const pergunta = typeof entrada?.pergunta === "string" ? entrada.pergunta.trim() : "";
    if (!pergunta) return { ok: false, erro: "Escreva a pergunta da enquete" };
    if (pergunta.length > MAX_PERGUNTA) return { ok: false, erro: `A pergunta pode ter no máximo ${MAX_PERGUNTA} caracteres` };

    if (!Array.isArray(entrada?.opcoes)) return { ok: false, erro: "Informe as opções da enquete" };
    const opcoes: string[] = [];
    for (const o of entrada.opcoes) {
        if (typeof o !== "string") return { ok: false, erro: "Opção inválida" };
        const t = o.trim();
        if (t) opcoes.push(t); // opcao em branco e ignorada
    }
    if (opcoes.length < MIN_OPCOES) return { ok: false, erro: `A enquete precisa de pelo menos ${MIN_OPCOES} opções` };
    if (opcoes.length > MAX_OPCOES) return { ok: false, erro: `A enquete pode ter no máximo ${MAX_OPCOES} opções` };
    if (opcoes.some((o) => o.length > MAX_OPCAO)) return { ok: false, erro: `Cada opção pode ter no máximo ${MAX_OPCAO} caracteres` };
    const unicas = new Set(opcoes.map((o) => o.toLocaleLowerCase("pt-BR")));
    if (unicas.size !== opcoes.length) return { ok: false, erro: "Há opções repetidas" };

    const multipla = entrada.multipla === true;
    return { ok: true, pergunta, opcoes, multipla, selectableCount: multipla ? opcoes.length : 1 };
}

/** minha versao: le a lista de votos de uma opcao SO se for chave propria (opcao "constructor"/"toString" nao pega o prototipo) */
export function votosDaOpcao(votos: Record<string, string[]> | undefined, opcao: string): string[] {
    if (!votos || typeof votos !== "object" || !Object.hasOwn(votos, opcao)) return [];
    const lista = votos[opcao];
    return Array.isArray(lista) ? lista.filter((j): j is string => typeof j === "string") : [];
}

/** minha versao: grava como propriedade propria (defineProperty), assim a opcao "__proto__" nao troca o prototipo do objeto */
function gravarPropria<T>(alvo: Record<string, T>, chave: string, valor: T): void {
    Object.defineProperty(alvo, chave, { value: valor, enumerable: true, writable: true, configurable: true });
}

/** le Message.extra.enquete com seguranca (extra pode ser qualquer coisa vinda do banco) */
export function lerEnquete(extra: unknown): Enquete | null {
    const e = (extra as { enquete?: unknown } | null | undefined)?.enquete as Partial<Enquete> | undefined;
    if (!e || typeof e !== "object" || typeof e.nome !== "string" || !Array.isArray(e.opcoes)) return null;
    const opcoes = e.opcoes.filter((o): o is string => typeof o === "string");
    if (!opcoes.length) return null;
    const votos: Record<string, string[]> = {};
    if (e.votos && typeof e.votos === "object") {
        for (const [op, jids] of Object.entries(e.votos)) {
            if (opcoes.includes(op) && Array.isArray(jids)) gravarPropria(votos, op, jids.filter((j): j is string => typeof j === "string"));
        }
    }
    return { nome: e.nome, opcoes, multipla: e.multipla === true, votos };
}

export type LinhaPlacar = { nome: string; votos: number; jids: string[]; percentual: number };
export type Placar = { opcoes: LinhaPlacar[]; totalVotantes: number };

/** placar: votos por opcao, % sobre quem votou (cada pessoa conta uma vez) */
export function montarPlacar(enquete: Pick<Enquete, "opcoes" | "votos">): Placar {
    const votantes = new Set<string>();
    const bruto = enquete.opcoes.map((nome) => {
        const jids = [...new Set(votosDaOpcao(enquete.votos, nome))];
        jids.forEach((j) => votantes.add(j));
        return { nome, jids };
    });
    const total = votantes.size;
    return {
        totalVotantes: total,
        opcoes: bruto.map((o) => ({
            nome: o.nome,
            jids: o.jids,
            votos: o.jids.length,
            percentual: total ? Math.round((o.jids.length / total) * 100) : 0,
        })),
    };
}

export type EstadoVotos = { votos: Record<string, string[]>; vezes: Record<string, number> };

/**
 * Aplica o voto de UMA pessoa: ela sai de todas as opcoes e entra so nas escolhidas (voto novo substitui o antigo;
 * lista vazia = voto retirado). `vezes` guarda a hora do ultimo voto de cada pessoa: um voto MAIS ANTIGO que o ja
 * contado (historico chegando fora de ordem) e ignorado. Devolve objetos novos.
 */
export function aplicarVoto(
    atual: EstadoVotos,
    opcoes: string[],
    votante: string,
    escolhidas: string[],
    quando: number
): EstadoVotos & { mudou: boolean } {
    const anterior = Object.hasOwn(atual.vezes, votante) ? atual.vezes[votante] : undefined;
    if (typeof anterior === "number" && quando < anterior) return { ...atual, mudou: false };

    const validas = new Set(escolhidas.filter((o) => opcoes.includes(o)));
    const votos: Record<string, string[]> = {};
    for (const op of opcoes) {
        const outros = votosDaOpcao(atual.votos, op).filter((j) => j !== votante);
        const lista = validas.has(op) ? [...outros, votante] : outros;
        if (lista.length) gravarPropria(votos, op, lista);
    }
    const mudou = JSON.stringify(votos) !== JSON.stringify(atual.votos);
    const vezes: Record<string, number> = { ...atual.vezes };
    gravarPropria(vezes, votante, quando);
    return { votos, vezes, mudou };
}
