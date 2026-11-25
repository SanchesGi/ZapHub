// minha versao: logica PURA da administracao de grupo (sem dependencias, testavel com node:test).
// Valida/normaliza numeros, decide o que a tela mostra a partir do papel e interpreta a resposta do WhatsApp.

// ─── PAPEL NO GRUPO ────────────────
export type PapelNoGrupo = "superadmin" | "admin" | "membro" | "desconhecido";

/** parte do usuario de um JID, sem servidor nem sufixo de aparelho: "5546999998888:12@s.whatsapp.net" -> "5546999998888" */
export function parteUsuarioJid(jid?: string | null): string {
    if (!jid) return "";
    const antesDoServidor = String(jid).split("@")[0] ?? "";
    return (antesDoServidor.split(":")[0] ?? "").trim().toLowerCase();
}

/** algum dos ids do candidato (id, lid, telefone) bate com algum dos ids da conta da sessao? */
export function ehMesmaConta(candidatos: Array<string | null | undefined>, meusIds: Array<string | null | undefined>): boolean {
    const meus = new Set(meusIds.map(parteUsuarioJid).filter(Boolean));
    if (meus.size === 0) return false;
    return candidatos.some((c) => {
        const u = parteUsuarioJid(c);
        return !!u && meus.has(u);
    });
}

export interface ParticipanteBruto {
    id?: string | null;
    lid?: string | null;
    jid?: string | null;
    phoneNumber?: string | null;
    admin?: string | null;
}

/** papel da conta da sessao no grupo. "desconhecido" = nao deu para saber quem e a conta (socket sem identidade) */
export function papelNoGrupo(participantes: ParticipanteBruto[], meusIds: Array<string | null | undefined>): PapelNoGrupo {
    if (!meusIds.some((i) => parteUsuarioJid(i))) return "desconhecido";
    const eu = participantes.find((p) => ehMesmaConta([p.id, p.lid, p.jid, p.phoneNumber], meusIds));
    if (!eu) return "membro";
    if (eu.admin === "superadmin") return "superadmin";
    if (eu.admin === "admin") return "admin";
    return "membro";
}

// ─── O QUE A TELA MOSTRA ───────────
export interface PermissoesGrupo {
    /** true = mostra os botoes de administracao */
    podeAgir: boolean;
    /** quando nao pode agir: por que (texto para a tela) */
    motivoLeitura: string | null;
}

export function permissoesDoGrupo(podeGerenciar: boolean, papel: PapelNoGrupo): PermissoesGrupo {
    if (!podeGerenciar) {
        return { podeAgir: false, motivoLeitura: "Só quem gerencia esta sessão (dono, Supervisor ou Super Administrador) pode alterar o grupo." };
    }
    if (papel === "desconhecido") {
        return { podeAgir: false, motivoLeitura: "Não consegui confirmar se a conta desta sessão é administradora do grupo. Confira se a sessão está conectada." };
    }
    if (papel === "membro") {
        return { podeAgir: false, motivoLeitura: "Só administradores do grupo podem alterar. A conta desta sessão é apenas membro." };
    }
    return { podeAgir: true, motivoLeitura: null };
}

export interface AcoesDoMembro {
    promover: boolean;
    rebaixar: boolean;
    remover: boolean;
}

/** quais botoes aparecem na linha de um membro (nunca no criador do grupo nem na propria conta) */
export function acoesDoMembro(podeAgir: boolean, membro: { admin?: string | null; souEu?: boolean }): AcoesDoMembro {
    const nenhuma = { promover: false, rebaixar: false, remover: false };
    if (!podeAgir || membro.souEu || membro.admin === "superadmin") return nenhuma;
    const ehAdmin = membro.admin === "admin";
    return { promover: !ehAdmin, rebaixar: ehAdmin, remover: true };
}

// ─── NUMEROS ───────────────────────
export const MAX_NUMEROS_POR_VEZ = 20;

export type NumeroNormalizado =
    | { ok: true; entrada: string; numero: string; jid: string }
    | { ok: false; entrada: string; motivo: string };

function validarBrasil(local: string): string | null {
    if (local.length !== 10 && local.length !== 11) return "Número brasileiro deve ter DDD + 8 ou 9 dígitos";
    const ddd = local.slice(0, 2);
    if (ddd[0] === "0" || ddd[1] === "0") return "DDD inválido";
    const resto = local.slice(2);
    if (resto.length === 9 && resto[0] !== "9") return "Celular com 9 dígitos deve começar com 9";
    if (resto.length === 8 && resto[0] === "0") return "Número inválido";
    if (resto.length === 8 && resto[0] === "1") return "Número inválido";
    return null;
}

/**
 * Aceita "(46) 99999-8888", "46999998888", "5546999998888", "+55 46 99999-8888" e o JID "5546999998888@s.whatsapp.net".
 * Numero de outro pais so com "+" na frente (sem ele, nao da para saber se e DDD).
 */
export function normalizarNumero(entrada: string): NumeroNormalizado {
    const original = String(entrada ?? "").trim();
    const falha = (motivo: string): NumeroNormalizado => ({ ok: false, entrada: original, motivo });
    if (!original) return falha("Vazio");
    if (original.endsWith("@g.us") || original.endsWith("@lid")) return falha("Use o número de telefone");

    const semServidor = original.replace(/@s\.whatsapp\.net$/i, "");
    const comMais = semServidor.startsWith("+");
    const digitos = semServidor.replace(/\D/g, "");
    if (!digitos) return falha("Sem dígitos");
    if (!/^[\d\s()+.\-]+$/.test(semServidor)) return falha("Use só números, espaço, parênteses e hífen");

    let numero: string;
    if (comMais) {
        if (digitos.startsWith("0")) return falha("Número internacional não começa com 0");
        if (digitos.length < 8 || digitos.length > 15) return falha("Número internacional deve ter de 8 a 15 dígitos");
        if (digitos.startsWith("55")) {
            const erro = validarBrasil(digitos.slice(2));
            if (erro) return falha(erro);
        }
        numero = digitos;
    } else {
        const limpo = digitos.replace(/^0+/, "");
        if (limpo.startsWith("55") && (limpo.length === 12 || limpo.length === 13)) {
            const erro = validarBrasil(limpo.slice(2));
            if (erro) return falha(erro);
            numero = limpo;
        } else if (limpo.length === 10 || limpo.length === 11) {
            const erro = validarBrasil(limpo);
            if (erro) return falha(erro);
            numero = `55${limpo}`;
        } else if (limpo.length > 11) {
            return falha("Para número de outro país, comece com +");
        } else {
            return falha("Faltam dígitos (informe o DDD)");
        }
    }
    return { ok: true, entrada: original, numero, jid: `${numero}@s.whatsapp.net` };
}

export interface LeituraDeNumeros {
    validos: Array<{ entrada: string; numero: string; jid: string }>;
    invalidos: Array<{ entrada: string; motivo: string }>;
    /** quantos numeros repetidos foram ignorados */
    repetidos: number;
}

/** separa por linha, virgula ou ponto e virgula; valida cada numero e tira os repetidos */
export function lerNumeros(texto: string): LeituraDeNumeros {
    const vistos = new Set<string>();
    const validos: LeituraDeNumeros["validos"] = [];
    const invalidos: LeituraDeNumeros["invalidos"] = [];
    let repetidos = 0;
    for (const pedaco of String(texto ?? "").split(/[\n\r,;]+/)) {
        const entrada = pedaco.trim();
        if (!entrada) continue;
        const r = normalizarNumero(entrada);
        if (!r.ok) { invalidos.push({ entrada: r.entrada, motivo: r.motivo }); continue; }
        if (vistos.has(r.numero)) { repetidos++; continue; }
        vistos.add(r.numero);
        validos.push({ entrada: r.entrada, numero: r.numero, jid: r.jid });
    }
    return { validos, invalidos, repetidos };
}

// ─── RESULTADO DE "ADICIONAR" ──────
export type SituacaoAdicao = "adicionado" | "ja_no_grupo" | "convite" | "saiu_recentemente" | "sem_whatsapp" | "sem_permissao" | "sem_resposta" | "falhou";

export interface ResultadoAdicao {
    numero: string;
    situacao: SituacaoAdicao;
    ok: boolean;
    mensagem: string;
}

const MENSAGEM_ADICAO: Record<SituacaoAdicao, string> = {
    adicionado: "Adicionado ao grupo",
    ja_no_grupo: "Já está no grupo",
    convite: "A privacidade da pessoa não permite ser adicionada direto. Envie o link de convite do grupo para ela",
    saiu_recentemente: "Saiu do grupo há pouco tempo e não pode ser readicionada agora",
    sem_whatsapp: "Número não encontrado no WhatsApp",
    sem_permissao: "O WhatsApp não permitiu adicionar este número",
    sem_resposta: "O WhatsApp não respondeu sobre este número. Confira a lista de membros",
    falhou: "Não foi possível adicionar"
};

function situacaoDoStatus(status: string): SituacaoAdicao {
    switch (status) {
        case "200": return "adicionado";
        case "409": return "ja_no_grupo";
        case "403": return "convite";
        case "408": return "saiu_recentemente";
        case "404": return "sem_whatsapp";
        case "401": return "sem_permissao";
        default: return "falhou";
    }
}

/**
 * Junta a resposta do Baileys ([{ status, jid }]) com os numeros enviados.
 * Casa pelo numero do JID; se o WhatsApp devolver outro formato (ex.: LID) e a quantidade bater, casa pela ordem.
 */
export function interpretarResultadoAdicao(resposta: unknown, enviados: Array<{ numero: string; jid: string }>): ResultadoAdicao[] {
    const lista = Array.isArray(resposta) ? resposta.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : [];
    const porUsuario = new Map<string, Record<string, unknown>>();
    for (const r of lista) {
        const u = parteUsuarioJid(typeof r.jid === "string" ? r.jid : "");
        if (u) porUsuario.set(u, r);
    }
    const mesmaQuantidade = lista.length === enviados.length;
    return enviados.map((e, i) => {
        const r = porUsuario.get(parteUsuarioJid(e.jid)) ?? (mesmaQuantidade ? lista[i] : undefined);
        const situacao: SituacaoAdicao = r ? situacaoDoStatus(String(r.status ?? "")) : "sem_resposta";
        return { numero: e.numero, situacao, ok: situacao === "adicionado", mensagem: MENSAGEM_ADICAO[situacao] };
    });
}

// ─── MENSAGENS TEMPORARIAS ─────────
export const OPCOES_TEMPORARIAS: ReadonlyArray<{ valor: number; rotulo: string }> = [
    { valor: 0, rotulo: "Desligadas" },
    { valor: 86400, rotulo: "24 horas" },
    { valor: 604800, rotulo: "7 dias" },
    { valor: 7776000, rotulo: "90 dias" }
];

export function rotuloTemporarias(segundos?: number | null): string {
    const s = Number(segundos) || 0;
    const achada = OPCOES_TEMPORARIAS.find((o) => o.valor === s);
    if (achada) return achada.rotulo;
    // valor que a API nao oferece (ex.: definido pelo celular): mostra em dias/horas
    if (s % 86400 === 0) return `${s / 86400} dias`;
    return `${Math.round(s / 3600)} horas`;
}

// ─── SAIR DO GRUPO ─────────────────
export const PALAVRA_SAIR = "SAIR";

export function confirmouSaida(digitado: string): boolean {
    return String(digitado ?? "").trim().toUpperCase() === PALAVRA_SAIR;
}

// ─── NOME E DESCRICAO ──────────────
export const MAX_NOME_GRUPO = 100;
export const MAX_DESCRICAO_GRUPO = 512;

/** erro de validacao do nome (null = ok) */
export function validarNomeGrupo(nome: string): string | null {
    const n = String(nome ?? "").trim();
    if (!n) return "O nome não pode ficar vazio";
    if (n.length > MAX_NOME_GRUPO) return `O nome pode ter até ${MAX_NOME_GRUPO} caracteres`;
    return null;
}

export function validarDescricaoGrupo(descricao: string): string | null {
    if (String(descricao ?? "").length > MAX_DESCRICAO_GRUPO) return `A descrição pode ter até ${MAX_DESCRICAO_GRUPO} caracteres`;
    return null;
}

// ─── ERROS DA API ──────────────────
/** texto em portugues para a falha de uma rota de grupo (as rotas respondem em ingles, exceto a de permissao) */
export function mensagemDeErroGrupo(status: number, mensagemDoServidor: string | null | undefined, acao: string): string {
    const msg = String(mensagemDoServidor ?? "");
    if (status === 401) return "Sua sessão no painel expirou. Entre de novo.";
    if (status === 403) {
        return msg.startsWith("Sem permissão") ? msg : "A conta desta sessão não é administradora do grupo, então o WhatsApp recusou.";
    }
    if (status === 404) return "Grupo não encontrado. A conta da sessão ainda está nele?";
    if (status === 503) return "A sessão do WhatsApp não está conectada agora.";
    if (status === 400) return `Dados inválidos para ${acao}.`;
    return `Não foi possível ${acao}. Tente de novo em instantes.`;
}
