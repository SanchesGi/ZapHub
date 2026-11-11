import makeWASocket, {
    DisconnectReason,
    generateMessageIDV2,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { bindPpGuard } from "./store/ppguard";
import { bindEstadoChat } from "./store/estado-chat";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";
import { prepararMidiaSegura } from "@/lib/midia-segura";
import { salaGestao } from "@/lib/session-access";
import { isInteractiveContent, handleInteractiveMessageDispatch } from "./interactive";
import { marcarEnvioPlataforma } from "@/lib/agente";

// minha versao: sessao "amarrada".
// - Sessao JA PAREADA nunca desiste: reconecta para sempre com espera crescente (2 s ... 2 min).
//   So para quando o usuario clica em Parar/Desconectar na plataforma, ou quando o aparelho desloga (401).
// - Sessao que ainda espera o QR (nunca pareada) desiste depois de algumas tentativas (nao fica gerando QR a toa).
// - Uma conexao por sessao: cada init() encerra a anterior e os eventos de conexoes antigas sao ignorados
//   (antes, reconexoes empilhavam sockets da mesma sessao que se derrubavam com "conflict: replaced").
// - Falha ao iniciar (ex.: sem internet) reagenda a tentativa; um vigia a cada minuto pega conexao morta em silencio.
const ESPERAS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000];
const MAX_TENTATIVAS_SEM_PAREAR = 3;
const VIGIA_MS = 60_000;

// versao do protocolo do WhatsApp Web: busca a mais nova, mas sem internet usa a ultima conhecida
let versaoCache: [number, number, number] | null = null;
async function versaoWhatsApp(): Promise<[number, number, number] | undefined> {
    try {
        const r = await Promise.race([
            fetchLatestBaileysVersion(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), 8_000)),
        ]);
        if (r?.version) versaoCache = r.version as [number, number, number];
    } catch { /* usa o cache (ou o padrao do Baileys) */ }
    return versaoCache || undefined;
}

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    /** motivo da ultima queda (aparece no log e no painel) */
    ultimoMotivo: string | null = null;
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    private geracao = 0;              // cada init() cria uma geracao; eventos de geracoes antigas sao ignorados
    private tentativas = 0;
    private timerReconexao: ReturnType<typeof setTimeout> | null = null;
    private iniciando = false;
    private pareada = false;          // tem credenciais validas (ja escaneou o QR alguma vez)
    private vigia: ReturnType<typeof setInterval> | null = null;
    private wsFechadoSeguidas = 0;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    async init() {
        if (this.timerReconexao) { clearTimeout(this.timerReconexao); this.timerReconexao = null; }
        const minha = ++this.geracao;

        // encerra a conexao anterior; os eventos dela passam a ser ignorados (geracao antiga)
        const antiga = this.socket;
        this.socket = null;
        if (antiga) {
            try { (antiga.ev as any).removeAllListeners?.("connection.update"); } catch { /* ignora */ }
            try { antiga.end(undefined); } catch { /* ja estava fechada */ }
        }

        this.iniciando = true;
        try {
            const sessionData = await prisma.session.findUnique({
                where: { sessionId: this.sessionId },
                include: { botConfig: true }
            });
            if (!sessionData) {
                logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
                return;
            }
            if (minha !== this.geracao) return; // outro init() comecou enquanto este esperava
            this.config = sessionData?.config || {};
            const botConfig = (sessionData as any)?.botConfig;

            const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
            this.pareada = !!state.creds?.me?.id;
            const version = await versaoWhatsApp();
            if (minha !== this.geracao || this.isStopped) return;

            const sock = makeWASocket({
                ...(version ? { version } : {}),
                logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any),
                },
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
                syncFullHistory: true,
                connectTimeoutMs: 30_000,
                keepAliveIntervalMs: 25_000,
            });
            this.socket = sock;

            // Attach Lekzo Baileys compatible helper methods
            const currentSocket = sock as any;
            currentSocket.newsletterId = async (url: string) => {
                const cleanUrl = url.trim();
                const inviteCode = cleanUrl.includes("/") ? cleanUrl.split("/").filter(Boolean).pop()! : cleanUrl;
                const meta = await currentSocket.newsletterMetadata("invite", inviteCode);
                return meta?.id || null;
            };
            currentSocket.checkWhatsApp = async (target: string) => {
                return await currentSocket.onWhatsApp(target);
            };

            // Apply Anti-Spam & Interactive Message Wrapper to sendMessage
            const originalSendMessage = sock.sendMessage.bind(sock);
            const sessionId = this.sessionId;
            sock.sendMessage = async function (jid: string, rawContent: any, options?: any) {
                // minha versao: nenhuma URL de midia chega crua ao Baileys (ver lib/midia-segura)
                const content = await prepararMidiaSegura(rawContent);
                await antispam.enqueue(sessionId, jid, content);
                if (isInteractiveContent(content)) {
                    const interactiveMsg = await handleInteractiveMessageDispatch(sock, jid, content, options);
                    if (interactiveMsg) {
                        if (interactiveMsg?.key?.id) marcarEnvioPlataforma(interactiveMsg.key.id);
                        return interactiveMsg;
                    }
                }
                // minha versao: id gerado ANTES do envio e marcado como "da plataforma" -> o que chegar sem a marca
                // foi enviado fora (celular/outro aparelho)
                const messageId = options?.messageId || generateMessageIDV2(sock.user?.id);
                marcarEnvioPlataforma(messageId);
                return originalSendMessage(jid, content, { ...(options || {}), messageId });
            } as any;

            // Bind Store for DB Sync
            bindSessionStore(sock, this.sessionId, this.io);

            // Bind Contact Sync
            bindContactSync(sock, this.sessionId);

            // minha versao: arquivada / silenciada / fixada espelhadas do WhatsApp
            bindEstadoChat(sock, this.sessionId, this.io);

            sock.ev.on("creds.update", async (...a: any[]) => {
                try { await (saveCreds as any)(...a); } catch (e) { logger.error("Instance", "Falha ao salvar credenciais", e); }
                if (!this.pareada && state.creds?.me?.id) this.pareada = true;
            });

            sock.ev.on("connection.update", async (update) => {
                if (minha !== this.geracao) return; // evento de uma conexao antiga
                await this.handleConnectionUpdate(update);
            });
        } catch (e: any) {
            logger.error("Instance", `Session ${this.sessionId}: falha ao iniciar a conexao (${e?.message || e})`);
            if (minha === this.geracao) this.agendarReconexao(`falha ao iniciar: ${e?.message || e}`);
        } finally {
            if (minha === this.geracao) this.iniciando = false;
            this.ligarVigia();
        }
    }

    /** QR e codigo de pareamento vinculam o WhatsApp: so quem gerencia a sessao recebe; os demais recebem so o status. */
    private emitirConexao(dados: { status: string; qr: string | null; pairingCode?: string }) {
        const gestao = salaGestao(this.sessionId);
        this.io?.to(gestao).emit("connection.update", dados);
        this.io?.to(this.sessionId).except(gestao).emit("connection.update", { status: dados.status, qr: null });
    }

    /** agenda UMA reconexao (se ja houver uma marcada, nao faz nada) */
    private agendarReconexao(motivo: string, minimoMs = 0) {
        if (this.isStopped || this.timerReconexao) return;
        this.tentativas++;
        this.ultimoMotivo = motivo;

        // sessao nunca pareada (esperando QR): nao fica gerando QR para sempre
        if (!this.pareada && this.tentativas > MAX_TENTATIVAS_SEM_PAREAR) {
            this.pararSozinha(`QR não escaneado depois de ${MAX_TENTATIVAS_SEM_PAREAR} tentativas`);
            return;
        }

        const base = ESPERAS_MS[Math.min(this.tentativas - 1, ESPERAS_MS.length - 1)];
        const espera = Math.max(base, minimoMs) + Math.floor(Math.random() * 1_000);
        this.status = "DISCONNECTED";
        this.io?.to(this.sessionId).emit("connection.update", { status: "DISCONNECTED", qr: null, motivo, proximaTentativaEm: espera });
        prisma.session.update({ where: { sessionId: this.sessionId }, data: { status: "DISCONNECTED", qr: null } }).catch(() => {});
        logger.warn("Instance", `Session ${this.sessionId} fora do ar (${motivo}). Tentativa ${this.tentativas} em ${Math.round(espera / 1000)} s...`);

        this.timerReconexao = setTimeout(() => {
            this.timerReconexao = null;
            if (!this.isStopped) this.init();
        }, espera);
    }

    /** so para sessao que nunca foi pareada (QR nao escaneado) */
    private async pararSozinha(motivo: string) {
        this.isStopped = true;
        this.status = "STOPPED";
        this.socket = null;
        this.tentativas = 0;
        this.desligarVigia();
        this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null, motivo });
        await prisma.session.update({ where: { sessionId: this.sessionId }, data: { status: "STOPPED", qr: null } }).catch(() => {});
        logger.warn("Instance", `Session ${this.sessionId} parada: ${motivo}.`);
        this.onRemovedFromManager?.();
    }

    /** vigia: conexao que morreu sem avisar, ou sessao fora do ar sem reconexao marcada */
    private ligarVigia() {
        if (this.vigia || this.isStopped) return;
        this.vigia = setInterval(() => {
            if (this.isStopped) { this.desligarVigia(); return; }
            if (this.status === "CONNECTED") {
                const ws: any = (this.socket as any)?.ws;
                const aberto = ws ? (typeof ws.isOpen === "boolean" ? ws.isOpen : ws.readyState === 1) : false;
                if (!aberto) {
                    if (++this.wsFechadoSeguidas >= 2) {
                        this.wsFechadoSeguidas = 0;
                        logger.warn("Instance", `Session ${this.sessionId}: conexao morreu sem aviso, reconectando.`);
                        this.status = "DISCONNECTED";
                        this.agendarReconexao("conexão caiu sem aviso");
                    }
                } else {
                    this.wsFechadoSeguidas = 0;
                }
            } else if (this.status !== "SCAN_QR" && !this.timerReconexao && !this.iniciando) {
                this.agendarReconexao("vigia: sessão fora do ar");
            }
        }, VIGIA_MS);
    }

    private desligarVigia() {
        if (this.vigia) { clearInterval(this.vigia); this.vigia = null; }
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>) {
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                this.qr = qr;
                this.status = "SCAN_QR";

                this.emitirConexao({ status: this.status, qr });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const err: any = lastDisconnect?.error;
                const code = err?.output?.statusCode;
                const motivo = `${code ?? "?"} ${err?.message || ""}`.trim();

                if (code === DisconnectReason.loggedOut) {
                    // Deslogado no aparelho (ou pela plataforma): para de vez e apaga as credenciais
                    // minha versao: registra o motivo exato (ex.: conflict/device_removed ou Intentional Logout)
                    logger.error("Instance", `Session ${this.sessionId} deslogada: ${motivo} | detalhe: ${JSON.stringify(err?.data ?? null)}`);
                    this.status = "LOGGED_OUT";
                    this.socket = null;
                    this.config = {};
                    this.desligarVigia();
                    if (this.timerReconexao) { clearTimeout(this.timerReconexao); this.timerReconexao = null; }
                    this.io?.to(this.sessionId).emit("connection.update", { status: "LOGGED_OUT", qr: null });

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId }
                            })
                        ]);
                    } catch (e) { /* ignore */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Parada pela plataforma: preserva as credenciais para religar depois
                    this.status = "STOPPED";
                    this.socket = null;
                    this.tentativas = 0;
                    this.desligarVigia();
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    const { waManager } = require("./manager");
                    waManager.removeInstance(this.sessionId);
                    return;
                }

                this.socket = null;

                if (code === DisconnectReason.restartRequired) {
                    // normal logo depois de escanear o QR: reconecta na hora, sem contar tentativa
                    logger.info("Instance", `Session ${this.sessionId}: reinicio pedido pelo WhatsApp, reconectando.`);
                    this.init();
                    return;
                }
                if (code === DisconnectReason.connectionReplaced) {
                    // outra conexao com as MESMAS credenciais (outro servidor/processo?) -> espera mais para nao brigar
                    logger.error("Instance", `Session ${this.sessionId}: conexao substituida por outra com as mesmas credenciais (outro servidor rodando?).`);
                    this.agendarReconexao("substituída por outra conexão", 30_000);
                    return;
                }
                if (code === DisconnectReason.forbidden) {
                    this.agendarReconexao("acesso negado pelo WhatsApp (403)", 5 * 60_000);
                    return;
                }

                // queda comum (internet, timeout, servidor do WhatsApp...): tenta de novo, para sempre
                this.agendarReconexao(motivo || "conexão fechada");
            }

            if (connection === "open") {
                // Connected — reset reconnect state
                this.tentativas = 0;
                this.wsFechadoSeguidas = 0;
                this.ultimoMotivo = null;
                this.isStopped = false;
                this.pareada = true;
                this.status = "CONNECTED";
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", { status: "CONNECTED", qr: null });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null }
                });

                const sock = this.socket as WASocket;
                bindAutoReply(sock, this.sessionId);
                bindPpGuard(sock, this.sessionId);

                // grupos em segundo plano (nao segura a conexao)
                syncGroups(sock, this.sessionId).catch((e) => logger.error("Instance", "Group sync failed:", e));

                logger.success("Instance", `Session ${this.sessionId} connected and synced successfully`);
            }
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.isStopped = true;
                this.desligarVigia();
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.emitirConexao({ status: this.status, qr: this.qr, pairingCode: code });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        this.geracao++; // eventos da conexao atual passam a ser ignorados
        if (this.timerReconexao) { clearTimeout(this.timerReconexao); this.timerReconexao = null; }
        this.desligarVigia();
        try { this.socket?.end(undefined); } catch { /* ja fechada */ }
        this.socket = null;
        this.tentativas = 0;
    }
}
