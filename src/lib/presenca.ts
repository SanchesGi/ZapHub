// minha versao: "digitando…", "gravando áudio…", "online" e "visto por último" (presenca do WhatsApp).
// Sem dependencias: usado no servidor (traduz o evento do Baileys) e na tela (monta o texto do cabecalho).

export type EstadoPresenca = "digitando" | "gravando" | "online" | "offline";
export type ItemPresenca = { quem: string; estado: EstadoPresenca; vistoEm: number | null };

/** JID aceito para assinar presenca: conversa individual, grupo ou LID. */
export const JID_PRESENCA = /^[\w.:-]{1,80}@(s\.whatsapp\.net|g\.us|lid)$/;

export function estadoDaPresenca(valor?: string | null): EstadoPresenca {
    if (valor === "composing") return "digitando";
    if (valor === "recording") return "gravando";
    if (valor === "available") return "online";
    return "offline";
}

/** Sem novidade em ate 25 s, "digitando" some (o WhatsApp as vezes nao manda o "parou"). */
export const VALIDADE_DIGITANDO_MS = 25_000;

function horaCurta(ms: number, agora: number): string {
    const d = new Date(ms);
    const hoje = new Date(agora);
    const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === hoje.toDateString()) return `hoje às ${hh}`;
    const ontem = new Date(agora - 86_400_000);
    if (d.toDateString() === ontem.toDateString()) return `ontem às ${hh}`;
    return `${d.toLocaleDateString("pt-BR")} às ${hh}`;
}

/**
 * Texto do cabecalho. Conversa individual: o estado da pessoa. Grupo: quem esta digitando/gravando.
 * `nomeDe` traduz o JID de um participante em nome. Devolve null quando nao ha nada a mostrar.
 */
export function textoPresenca(
    itens: ItemPresenca[],
    opcoes: { grupo: boolean; agora: number; nomeDe?: (jid: string) => string | null },
): string | null {
    if (!itens.length) return null;
    if (!opcoes.grupo) {
        const p = itens[0];
        if (p.estado === "digitando") return "digitando…";
        if (p.estado === "gravando") return "gravando áudio…";
        if (p.estado === "online") return "online";
        return p.vistoEm ? `visto por último ${horaCurta(p.vistoEm, opcoes.agora)}` : null;
    }
    const ativos = itens.filter((i) => i.estado === "digitando" || i.estado === "gravando");
    if (!ativos.length) return null;
    const nomes = ativos.map((i) => opcoes.nomeDe?.(i.quem) || "Alguém");
    const gravando = ativos.every((i) => i.estado === "gravando");
    const acao = gravando ? "gravando áudio…" : "digitando…";
    if (nomes.length === 1) return `${nomes[0]} está ${acao}`;
    if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]} estão ${acao}`;
    return `${nomes.length} pessoas estão ${acao}`;
}
