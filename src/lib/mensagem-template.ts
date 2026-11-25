/**
 * minha versao: le mensagens no formato antigo de template/botoes/lista (usado por orgaos publicos,
 * como alertas da Defesa Civil, e por bots de empresas). Antes elas ficavam gravadas so como "[template]",
 * sem texto, e a imagem do topo nunca era baixada.
 *
 * Sem dependencias: recebe o conteudo ja normalizado pelo Baileys (normalizeMessageContent).
 */

export type TipoTemplate = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type TemplateLido = { tipo: TipoTemplate; texto: string };

const MIDIA_PARA_TIPO: Array<[string, TipoTemplate]> = [
    ["imageMessage", "IMAGE"],
    // mesma ordem do Baileys (extractMessageContent): o tipo gravado bate com o arquivo baixado
    ["documentMessage", "DOCUMENT"],
    ["videoMessage", "VIDEO"],
];

function limpo(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function botoes(nomes: string[]): string {
    const validos = nomes.map(limpo).filter(Boolean);
    return validos.length ? validos.map((n) => `[🔘 ${n}]`).join("  ") : "";
}

function juntar(partes: { titulo?: string; corpo?: string; rodape?: string; extra?: string[] }): string {
    const blocos: string[] = [];
    if (partes.titulo) blocos.push(`*${partes.titulo}*`);
    if (partes.corpo) blocos.push(partes.corpo);
    if (partes.rodape) blocos.push(`_${partes.rodape}_`);
    const texto = blocos.join("\n");
    const resto = (partes.extra || []).filter(Boolean);
    return [texto, ...resto].filter(Boolean).join("\n\n");
}

function tipoDaMidia(obj: any): TipoTemplate {
    for (const [chave, tipo] of MIDIA_PARA_TIPO) if (obj?.[chave]) return tipo;
    return "TEXT";
}

function localizacao(obj: any): string {
    const l = obj?.locationMessage;
    if (!l) return "";
    const nome = limpo(l.name) || limpo(l.address);
    return `📍 ${nome ? nome + " " : ""}(${l.degreesLatitude},${l.degreesLongitude})`;
}

function lerHidratado(t: any): TemplateLido {
    const nomes = (t.hydratedButtons || []).map((b: any) =>
        b?.quickReplyButton?.displayText || b?.urlButton?.displayText || b?.callButton?.displayText || ""
    );
    const texto = juntar({
        titulo: limpo(t.hydratedTitleText),
        corpo: limpo(t.hydratedContentText),
        rodape: limpo(t.hydratedFooterText),
        extra: [localizacao(t), botoes(nomes)],
    });
    return { tipo: tipoDaMidia(t), texto };
}

function lerBotoes(b: any): TemplateLido {
    const nomes = (b.buttons || []).map((x: any) => x?.buttonText?.displayText || "");
    const texto = juntar({
        titulo: limpo(b.text),
        corpo: limpo(b.contentText),
        rodape: limpo(b.footerText),
        extra: [localizacao(b), botoes(nomes)],
    });
    return { tipo: tipoDaMidia(b), texto };
}

function lerLista(l: any): TemplateLido {
    const linhas: string[] = [];
    for (const s of l.sections || []) {
        const titulo = limpo(s?.title);
        if (titulo) linhas.push(`*${titulo}*`);
        for (const r of s?.rows || []) {
            const nome = limpo(r?.title);
            const desc = limpo(r?.description);
            if (nome) linhas.push(`• ${nome}${desc ? ` — ${desc}` : ""}`);
        }
    }
    const texto = juntar({
        titulo: limpo(l.title),
        corpo: limpo(l.description),
        rodape: limpo(l.footerText),
        extra: [linhas.join("\n"), botoes([l.buttonText])],
    });
    return { tipo: "TEXT", texto };
}

/** Le template, botoes ou lista. Devolve null se o conteudo nao for nenhum desses. */
export function lerTemplate(conteudo: any): TemplateLido | null {
    if (!conteudo || typeof conteudo !== "object") return null;

    let lido: TemplateLido | null = null;
    const tm = conteudo.templateMessage;
    const hidratado = tm?.hydratedTemplate || tm?.hydratedFourRowTemplate;
    if (hidratado) lido = lerHidratado(hidratado);
    else if (conteudo.buttonsMessage) lido = lerBotoes(conteudo.buttonsMessage);
    else if (conteudo.listMessage) lido = lerLista(conteudo.listMessage);

    if (!lido) return null;
    // mensagem sem texto e sem midia: melhor do que gravar vazio
    if (!lido.texto && lido.tipo === "TEXT") return { ...lido, texto: "[Mensagem de modelo]" };
    return lido;
}
