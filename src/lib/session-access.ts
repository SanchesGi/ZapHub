import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

// Role hierarchy for permission checks
export const ROLE_HIERARCHY = {
    SUPERADMIN: 3,
    STAFF: 2,
    USER: 1
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

/**
 * Check if user has required role level
 */
export function hasRole(userRole: string, requiredRole: Role): boolean {
    const userLevel = ROLE_HIERARCHY[userRole as Role] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
}

/**
 * Check if user is admin (SUPERADMIN or has admin privileges)
 */
export function isAdmin(userRole: string): boolean {
    return userRole === "SUPERADMIN";
}

/**
 * minha versao: acha a sessao pela chave que vem da URL, que pode ser o nome (Session.sessionId) ou o ID interno.
 * O nome tem prioridade e a busca e sempre deterministica (antes era "id OU nome" sem ordem, e um nome igual ao ID
 * de outra sessao podia resolver para a sessao errada). A criacao de sessao tambem recusa nomes assim.
 */
export async function buscarSessao<T extends Prisma.SessionSelect>(chave: string, select: T) {
    if (typeof chave !== "string" || !chave) return null;
    return (await prisma.session.findUnique({ where: { sessionId: chave }, select }))
        ?? (await prisma.session.findUnique({ where: { id: chave }, select }));
}

/**
 * Check if user can access a session
 * - SUPERADMIN can access all sessions
 * - Other users can access their own sessions OR sessions shared with them
 */
/**
 * minha versao: sessao PRIVADA de outro dono. Nem o Super Administrador a ve ou gerencia pelo painel e pela API.
 * (As ferramentas de LGPD continuam alcancando todas as sessoes: o controlador precisa exportar/apagar os dados de
 * um titular em qualquer lugar. Quem administra o servidor tambem tem acesso ao banco.)
 */
function privadaDeOutro(s: { userId: string; privada?: boolean | null } | null, userId: string): boolean {
    return !!s && !!s.privada && s.userId !== userId;
}

/** filtro Prisma das sessoes que um Super Administrador pode ver: todas menos as privadas de outros donos */
export function filtroSessoesVisiveisAoAdmin(userId: string) {
    return { OR: [{ privada: false }, { userId }] };
}

export async function canAccessSession(userId: string, userRole: string, sessionId: string): Promise<boolean> {
    if (isAdmin(userRole)) {
        const s = await buscarSessao(sessionId, { userId: true, privada: true });
        return !!s && !privadaDeOutro(s, userId);
    }
    const s = await buscarSessao(sessionId, { id: true, userId: true, privada: true });
    if (!s) return false;
    if (s.userId === userId) return true;
    if (s.privada) return false; // privada nunca vale por compartilhamento
    return !!(await prisma.sessionAccess.findUnique({ where: { sessionId_userId: { sessionId: s.id, userId } } }));
}

/**
 * Check if user is the actual owner of a session (not just shared access)
 * Used for protecting management endpoints (e.g. granting/revoking access)
 */
export async function isSessionOwner(userId: string, userRole: string, sessionId: string): Promise<boolean> {
    if (isAdmin(userRole)) {
        const s = await buscarSessao(sessionId, { userId: true, privada: true });
        return !!s && !privadaDeOutro(s, userId);
    }
    const s = await buscarSessao(sessionId, { userId: true });
    return !!s && s.userId === userId;
}

/**
 * minha versao: pode GERENCIAR a sessao (ligar/desligar/deslogar/apagar, QR, configuracoes, bot, respostas
 * automaticas, agendamentos, disparo, webhooks, perfil do WhatsApp, administracao de grupos, compartilhar...).
 * - SUPERADMIN: qualquer sessao
 * - dono da sessao (inclusive a sessao pessoal de quem e "Equipe"): a dele
 * - STAFF (Supervisor): as sessoes a que tem acesso (dono ou compartilhada com ele)
 * - USER (Equipe) numa sessao compartilhada: NAO — so o basico de conversa
 */
/** minha versao: sala de socket de quem gerencia a sessao (recebe QR e codigo de pareamento). */
export function salaGestao(sessionKey: string) {
    return `gestao:${sessionKey}`;
}

/** minha versao: tira o que so quem gerencia a sessao pode ver (membro comum fica so com o chat). */
export function ocultarDadosDeGestao<T extends Record<string, any>>(sessao: T): T {
    const { qr, pairingCode, webhooks, botConfig, ...resto } = sessao as any;
    const saida: any = { ...resto, qr: null, pairingCode: null, webhooks: [] };
    if (botConfig !== undefined) {
        saida.botConfig = botConfig ? { ...botConfig, removeBgApiKey: null } : botConfig;
    }
    return saida;
}

export async function podeGerenciarSessao(userId: string, userRole: string, sessionId: string): Promise<boolean> {
    if (isAdmin(userRole)) return canAccessSession(userId, userRole, sessionId);
    if (await isSessionOwner(userId, userRole, sessionId)) return true;
    if (userRole === "STAFF") return canAccessSession(userId, userRole, sessionId);
    return false;
}

/**
 * minha versao: acesso a uma sessao pelo ID INTERNO (Session.id), sem aceitar o nome (slug).
 * Usado quando a sessao vem de um registro do banco (ex.: a mensagem dona de uma midia).
 */
export async function canAccessSessionById(userId: string, userRole: string, sessionDbId: string): Promise<boolean> {
    const s = await prisma.session.findUnique({ where: { id: sessionDbId }, select: { userId: true, privada: true } });
    if (isAdmin(userRole)) return !!s && !privadaDeOutro(s, userId);
    if (!s) return false;
    if (s.userId === userId) return true;
    if (s.privada) return false; // privada nunca vale por compartilhamento
    const acesso = await prisma.sessionAccess.findUnique({ where: { sessionId_userId: { sessionId: sessionDbId, userId } } });
    return !!acesso;
}

/** minha versao: gerenciar pelo ID INTERNO (dono, SUPERADMIN, ou STAFF com acesso) */
export async function podeGerenciarSessaoPorId(userId: string, userRole: string, sessionDbId: string): Promise<boolean> {
    const s = await prisma.session.findUnique({ where: { id: sessionDbId }, select: { userId: true, privada: true } });
    if (isAdmin(userRole)) return !!s && !privadaDeOutro(s, userId);
    if (!s) return false;
    if (s.userId === userId) return true;
    return userRole === "STAFF" ? canAccessSessionById(userId, userRole, sessionDbId) : false;
}

/** minha versao: pode gerenciar usuarios (criar/editar/remover e adicionar as sessoes): Super Administrador e Supervisor */
export function podeGerenciarUsuarios(userRole: string): boolean {
    return userRole === "SUPERADMIN" || userRole === "STAFF";
}

/** minha versao: ids dos membros da equipe de um Supervisor (usuarios com supervisorId = ele) */
export async function idsDaEquipe(supervisorId: string): Promise<string[]> {
    const m = await prisma.user.findMany({ where: { supervisorId }, select: { id: true } });
    return m.map((u) => u.id);
}

/** minha versao: o Supervisor pode mexer neste usuario? (Super Administrador: qualquer um) */
export async function ehDaMinhaEquipe(quemId: string, quemRole: string, alvoId: string): Promise<boolean> {
    if (isAdmin(quemRole)) return true;
    if (quemRole !== "STAFF") return false;
    const alvo = await prisma.user.findUnique({ where: { id: alvoId }, select: { supervisorId: true, role: true } });
    return !!alvo && alvo.role === "USER" && alvo.supervisorId === quemId;
}

/**
 * Get sessions that user can access
 * - SUPERADMIN sees all
 * - Others see only their own + shared
 */
export async function getAccessibleSessions(userId: string, userRole: string) {
    if (isAdmin(userRole)) {
        return prisma.session.findMany({
            where: filtroSessoesVisiveisAoAdmin(userId),
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                botConfig: true,
                webhooks: true,
                _count: {
                    select: {
                        contacts: true,
                        messages: true,
                        groups: true,
                        autoReplies: true,
                        scheduledMessages: true,
                        sessionAccesses: true
                    }
                }
            }
        });
    }

    // Get sessions owned by user + sessions shared with user
    const [ownedSessions, sharedAccess] = await Promise.all([
        prisma.session.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                botConfig: true,
                webhooks: true,
                _count: {
                    select: {
                        contacts: true,
                        messages: true,
                        groups: true,
                        autoReplies: true,
                        scheduledMessages: true,
                        sessionAccesses: true
                    }
                }
            }
        }),
        prisma.sessionAccess.findMany({
            where: { userId },
            select: { sessionId: true }
        })
    ]);

    if (sharedAccess.length === 0) return ownedSessions;

    const sharedSessionIds = sharedAccess.map(a => a.sessionId);
    const ownedIds = new Set(ownedSessions.map(s => s.id));
    const missingIds = sharedSessionIds.filter(id => !ownedIds.has(id));

    if (missingIds.length === 0) return ownedSessions;

    const sharedSessions = await prisma.session.findMany({
        where: { id: { in: missingIds }, privada: false },
        orderBy: { createdAt: 'desc' },
        include: {
            user: {
                select: {
                    name: true,
                    email: true
                }
            },
            botConfig: true,
            webhooks: true,
            _count: {
                select: {
                    contacts: true,
                    messages: true,
                    groups: true,
                    autoReplies: true,
                    scheduledMessages: true,
                    sessionAccesses: true
                }
            }
        }
    });

    const sanitizedShared = sharedSessions.map(session => userRole === "STAFF" ? {
        ...session,
        webhooks: (session.webhooks || []).map((wh: any) => {
            const { secret, ...safeWh } = wh;
            return safeWh;
        })
    } : ocultarDadosDeGestao(session));

    return [...ownedSessions, ...sanitizedShared];
}
