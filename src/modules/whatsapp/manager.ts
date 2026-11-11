import { prisma } from "@/lib/prisma";
import { WhatsAppInstance } from "./instance";
import { Server } from "socket.io";
import { initScheduler } from "@/lib/cron";
import { logger } from "@/lib/logger";

/** minha versao: entrada recusada (a rota responde 400 com esta mensagem) */
export class ErroSessaoInvalida extends Error {}

export class WhatsAppManager {
    private static instance: WhatsAppManager;
    private sessions: Map<string, WhatsAppInstance> = new Map();
    public io: Server | null = null;

    private constructor() {
        initScheduler();
    }

    public static getInstance(): WhatsAppManager {
        if (!WhatsAppManager.instance) {
            WhatsAppManager.instance = new WhatsAppManager();
        }
        return WhatsAppManager.instance;
    }

    setup(io: Server) {
        this.io = io;
    }

    async loadSessions() {
        if (!this.io) throw new Error("Socket.IO not initialized in WhatsAppManager");
        // minha versao: religa tudo que estava pareado, MENOS o que o usuario parou (STOPPED) ou deslogou.
        // (antes religava ate as paradas de proposito; e as "paradas sozinhas" por erro ficavam paradas em execucao)
        const sessions = await prisma.session.findMany({
            where: {
                status: { notIn: ["LOGGED_OUT", "STOPPED"] }
            },
            select: { sessionId: true, userId: true, status: true }
        });

        let started = 0;
        for (const session of sessions) {
            // Only auto-init sessions that were CONNECTED before (have auth creds)
            const authCount = await prisma.authState.count({
                where: { sessionId: session.sessionId }
            });
            if (authCount === 0) {
                // No credentials — session was created but never connected
                // Set to STOPPED so it doesn't spam reconnect
                await prisma.session.update({
                    where: { sessionId: session.sessionId },
                    data: { status: "STOPPED" }
                }).catch(() => {});
                continue;
            }

            const instance = new WhatsAppInstance(session.sessionId, session.userId, this.io);
            instance.onRemovedFromManager = () => this.removeInstance(session.sessionId);
            this.sessions.set(session.sessionId, instance);
            // init nao derruba o carregamento das outras sessoes se uma falhar (ela se reagenda sozinha)
            await instance.init().catch((e) => logger.error("Manager", `Falha ao iniciar ${session.sessionId}`, e));
            started++;
        }
        logger.success("Manager", `Loaded ${started} sessions (${sessions.length - started} idle skipped).`);
    }

    async createSession(userId: string, name: string, customSessionId?: string) {
        if (!this.io && (global as any).io) {
            this.io = (global as any).io;
        }

        if (!this.io) {
            logger.error("Manager", "Socket.IO not initialized in WhatsAppManager");
            throw new Error("Socket.IO not initialized");
        }

        // minha versao: nome da sessao vira nome de sala e de arquivo, entao so aceita um formato seguro,
        // e nao pode copiar o ID interno de outra sessao (varias rotas aceitam os dois)
        if (customSessionId !== undefined && customSessionId !== null && customSessionId !== "") {
            if (typeof customSessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(customSessionId)) {
                throw new ErroSessaoInvalida("O ID da sessão aceita só letras, números, _ e -, até 64 caracteres.");
            }
            if (/^c[a-z0-9]{24}$/.test(customSessionId) || await prisma.session.findUnique({ where: { id: customSessionId }, select: { id: true } })) {
                throw new ErroSessaoInvalida("Este ID de sessão não pode ser usado.");
            }
        }
        const sessionId = customSessionId || Math.random().toString(36).substring(7);

        const session = await prisma.session.create({
            data: {
                userId,
                name,
                sessionId,
                status: "STOPPED", // Default: stopped, user must click Start
                botConfig: {
                    create: {
                        enabled: true,
                        botMode: "OWNER",
                        autoReplyMode: "ALL"
                    }
                }
            }
        });

        // Don't init socket — user clicks Start manually
        logger.info("Manager", `Session ${sessionId} created (STOPPED). User must click Start to connect.`);
        return session;
    }

    public getInstance(sessionId: string) {
        return this.sessions.get(sessionId);
    }

    /** Remove instance from memory manager (cleanup after stop/logout) */
    public removeInstance(sessionId: string) {
        const inst = this.sessions.get(sessionId);
        if (inst) {
            logger.info("Manager", `Removing session ${sessionId} from memory.`);
            this.sessions.delete(sessionId);
        }
    }

    async deleteSession(sessionId: string) {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            this.sessions.delete(sessionId);
        }
        const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!sessao) return;
        await prisma.$transaction([prisma.session.delete({ where: { sessionId } }), ...this.limparDadosDaSessao(sessionId, sessao.id)]);
    }

    /** minha versao: estas tabelas guardam o nome da sessao sem chave estrangeira. Sem isto, quem reusasse o nome herdava as credenciais do WhatsApp. */
    limparDadosDaSessao(sessionId: string, id: string) {
        return [
            prisma.authState.deleteMany({ where: { sessionId } }),
            prisma.label.deleteMany({ where: { sessionId: { in: [sessionId, id] } } }),
            prisma.broadcastLog.deleteMany({ where: { sessionId: { in: [sessionId, id] } } }),
        ];
    }

    async stopSession(sessionId: string) {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            instance.status = "STOPPED";
            // Remove from memory immediately
            this.sessions.delete(sessionId);
        }
        // minha versao: marca STOPPED sempre (mesmo fora da memoria) -> nao religa sozinha no proximo boot
        this.io?.to(sessionId).emit("connection.update", { status: "STOPPED", qr: null });
        await prisma.session.update({
            where: { sessionId },
            data: { status: "STOPPED", qr: null }
        }).catch(() => {});
    }

    async startSession(sessionId: string) {
        // If already running, do nothing
        const existingInstance = this.sessions.get(sessionId);
        if (existingInstance && existingInstance.status === "CONNECTED") {
            return;
        }

        const session = await prisma.session.findUnique({ where: { sessionId } });
        if (!session) throw new Error("Session not found");

        // Create fresh instance
        let instance = this.sessions.get(sessionId);
        if (!instance) {
            instance = new WhatsAppInstance(sessionId, session.userId, this.io!);
            instance.onRemovedFromManager = () => this.removeInstance(sessionId);
            this.sessions.set(sessionId, instance);
        } else {
            // Reset stopped flag for retry
            instance.isStopped = false;
        }

        await instance.init();
    }

    async restartSession(sessionId: string) {
        await this.stopSession(sessionId);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.startSession(sessionId);
    }

    async requestPairingCode(sessionId: string, phoneNumber: string) {
        const instance = this.sessions.get(sessionId);
        if (!instance) throw new Error("Instance not found or not running");
        return await instance.requestPairingCode(phoneNumber);
    }
}

const globalForWhatsapp = global as unknown as { waManager: WhatsAppManager };

export const waManager = globalForWhatsapp.waManager || WhatsAppManager.getInstance();

globalForWhatsapp.waManager = waManager;
