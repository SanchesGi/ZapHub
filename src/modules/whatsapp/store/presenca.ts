import type { WASocket } from "@whiskeysockets/baileys";
import type { Server } from "socket.io";
import { resolveToPhoneJidBySessionId } from "@/lib/jid-utils";
import { estadoDaPresenca, type ItemPresenca } from "@/lib/presenca";
import { logger } from "@/lib/logger";

// minha versao: repassa "digitando/online" do WhatsApp para a sala da sessao (so quem tem acesso a ela recebe).
// O WhatsApp so manda presenca de quem foi "assinado" (socket "assinar-presenca", ao abrir a conversa).
async function paraTelefone(jid: string, sessionId: string): Promise<string> {
    try {
        return await resolveToPhoneJidBySessionId(jid, sessionId);
    } catch {
        return jid;
    }
}

export function bindPresenca(sock: WASocket, sessionId: string, io: Server | null) {
    sock.ev.on("presence.update", async ({ id, presences }) => {
        try {
            if (!io || !id) return;
            const chat = await paraTelefone(id, sessionId);
            const itens: ItemPresenca[] = await Promise.all(
                Object.entries(presences || {}).map(async ([quem, p]: [string, any]) => ({
                    quem: await paraTelefone(quem, sessionId),
                    estado: estadoDaPresenca(p?.lastKnownPresence),
                    vistoEm: typeof p?.lastSeen === "number" ? p.lastSeen * 1000 : null,
                })),
            );
            io.to(sessionId).emit("presenca", { chat, itens });
        } catch (e) {
            logger.debug("Presenca", "Falha ao repassar presenca", e);
        }
    });
}
