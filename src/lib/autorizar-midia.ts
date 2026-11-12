// minha versao: quem pode ver/apagar uma midia vem do REGISTRO da mensagem (Message.mediaUrl -> sessao),
// nunca do prefixo do nome do arquivo (o nome e ambiguo: tracos no id da mensagem, nome de sessao reaproveitado).
// O nome so serve para achar candidatos no banco; a decisao usa o que esta gravado na mensagem.
import { prisma } from "./prisma";
import { nomeDeMidiaValido } from "./pasta-midia";
import { canAccessSessionById, podeGerenciarSessaoPorId } from "./session-access";

type Usuario = { id: string; role: string };

/** todas as divisoes possiveis de "<sessao>-<mensagem>" (o id da mensagem pode ter traco) */
export function divisoesDoNome(nome: string): { sessao: string; keyId: string }[] {
    if (!nomeDeMidiaValido(nome)) return [];
    const base = nome.slice(0, nome.lastIndexOf("."));
    const saida: { sessao: string; keyId: string }[] = [];
    for (let i = base.indexOf("-", 1); i > 0 && i < base.length - 1; i = base.indexOf("-", i + 1)) {
        saida.push({ sessao: base.slice(0, i), keyId: base.slice(i + 1) });
    }
    return saida;
}

/** IDs internos das sessoes cujas mensagens apontam para esta midia (usa os indices de sessao e chave) */
export async function sessoesDaMidia(nome: string): Promise<string[]> {
    const div = divisoesDoNome(nome);
    if (!div.length) return [];
    const sessoes = await prisma.session.findMany({
        where: { sessionId: { in: [...new Set(div.map((d) => d.sessao))] } },
        select: { id: true },
    });
    if (!sessoes.length) return [];
    const url = `/api/media/${nome}`;
    const msgs = await prisma.message.findMany({
        where: { sessionId: { in: sessoes.map((s) => s.id) }, keyId: { in: div.map((d) => d.keyId) }, mediaUrl: url },
        select: { sessionId: true },
    });
    return [...new Set(msgs.map((m) => m.sessionId))];
}

/**
 * Decide pelo registro no banco. Sem mensagem dona (arquivo orfao): so SUPERADMIN.
 * Se mais de uma sessao aponta para o mesmo nome (colisao), exige acesso a TODAS.
 */
/**
 * minha versao: arquivo sem mensagem dona (ex.: mensagem apagada) cujo nome comeca pelo id de uma sessao PRIVADA
 * de outro dono. Nao aparece para o Super Administrador nem como "sem dono".
 */
export async function ehOrfaDePrivadaDeOutro(nome: string, userId: string): Promise<boolean> {
    const div = divisoesDoNome(nome);
    if (!div.length) return false;
    const n = await prisma.session.count({ where: { sessionId: { in: [...new Set(div.map((d) => d.sessao))] }, privada: true, NOT: { userId } } });
    return n > 0;
}

export async function autorizarMidia(user: Usuario, nome: string, acao: "ver" | "apagar"): Promise<boolean> {
    if (!nomeDeMidiaValido(nome)) return false;
    const ids = await sessoesDaMidia(nome);
    if (!ids.length) return user.role === "SUPERADMIN" && !(await ehOrfaDePrivadaDeOutro(nome, user.id));
    const pode = acao === "ver" ? canAccessSessionById : podeGerenciarSessaoPorId;
    for (const id of ids) if (!(await pode(user.id, user.role, id))) return false;
    return true;
}
