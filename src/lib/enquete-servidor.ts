// minha versao: pecas do servidor para LER os votos de uma enquete (so node:crypto, sem Baileys nem banco).
// No Baileys 7.0.0-rc14 o voto chega CIFRADO (pollUpdateMessage) e a decifragem embutida esta comentada;
// por isso o painel decifra por conta propria (store/enquete-votos.ts), usando estas funcoes.
import { createHash } from "node:crypto";

/** hash (hex) que o WhatsApp usa para identificar uma opcao dentro do voto: sha256 do texto da opcao */
export function hashOpcao(nome: string): string {
    return createHash("sha256").update(Buffer.from(nome)).digest("hex");
}

/** opcoes (texto) correspondentes aos hashes do voto; hash desconhecido e ignorado */
export function opcoesDoVoto(selecionadas: ArrayLike<Uint8Array | number[]>, opcoes: string[]): string[] {
    const porHash = new Map(opcoes.map((o) => [hashOpcao(o), o]));
    const nomes: string[] = [];
    for (const s of Array.from(selecionadas)) {
        const nome = porHash.get(Buffer.from(s as Uint8Array).toString("hex"));
        if (nome && !nomes.includes(nome)) nomes.push(nome);
    }
    return nomes;
}

/** "5511999:4@s.whatsapp.net" -> "5511999@s.whatsapp.net"; "@c.us" vira "@s.whatsapp.net" */
export function jidSemAparelho(jid: string): string {
    return jid.replace(/:\d+(?=@)/, "").replace(/@c\.us$/, "@s.whatsapp.net");
}

/** lista de JIDs possiveis (sem aparelho, sem repetidos, sem vazios), na ordem dada */
export function jidsCandidatos(...jids: Array<string | null | undefined>): string[] {
    const saida: string[] = [];
    for (const j of jids) {
        if (typeof j !== "string" || !j.includes("@")) continue;
        const n = jidSemAparelho(j);
        if (!saida.includes(n)) saida.push(n);
    }
    return saida;
}

/**
 * A chave do voto depende do JID de quem criou e de quem votou, e o WhatsApp pode usar a forma de telefone OU a
 * @lid. Tenta cada combinacao: a cifra e autenticada (AES-GCM), entao so a combinacao certa decifra.
 */
export function decifrarComCandidatos<T>(
    criadores: string[],
    votantes: string[],
    tentar: (criador: string, votante: string) => T | null
): { resultado: T; criador: string; votante: string } | null {
    for (const criador of criadores) {
        for (const votante of votantes) {
            let r: T | null = null;
            try {
                r = tentar(criador, votante);
            } catch {
                r = null;
            }
            if (r !== null && r !== undefined) return { resultado: r, criador, votante };
        }
    }
    return null;
}

/** numero a partir de Long, string ou number (o horario do voto vem em ms); invalido ou zero -> padrao */
export function numeroDe(valor: unknown, padrao: number): number {
    const n = Number(typeof valor === "object" && valor !== null ? (valor as { toString(): string }).toString() : valor);
    return Number.isFinite(n) && n > 0 ? n : padrao;
}
