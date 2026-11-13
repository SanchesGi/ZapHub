import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { registrarApagada, marcarApagandoPeloPainel } from "@/lib/auditoria";
import { jidNormalizedUser } from "@whiskeysockets/baileys";
import { sincronizaEstadoChat } from "@/modules/whatsapp/store/estado-chat";

// DELETE: Delete message for everyone
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string; messageId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid, messageId } = await params;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);
        const sock: any = instance.socket;

        // minha versao: apaga DE VERDADE no WhatsApp e registra na auditoria quem apagou.
        // Antes mandava sempre fromMe:true -> mensagem recebida nao era apagada (so sumia da tela) e nada era registrado.
        const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        const msg = dbSession ? await prisma.message.findFirst({ where: { sessionId: dbSession.id, keyId: messageId } }) : null;
        const remoteJid = msg?.remoteJid || decodedJid;
        const fromMe = msg ? msg.fromMe : true;
        const isGroup = remoteJid.endsWith("@g.us");

        let participant: string | undefined;
        if (isGroup && !fromMe && msg?.senderJid) {
            const [u, d] = msg.senderJid.split("@");
            participant = d ? `${u.split(":")[0]}@${d}` : u;
        }
        const key = { remoteJid, fromMe, id: messageId, ...(participant ? { participant } : {}) };

        // mensagem minha -> para todos; de outra pessoa em grupo onde sou admin -> para todos; senao so para mim
        let modo: "TODOS" | "PARA_MIM" = "TODOS";
        if (!fromMe) {
            modo = "PARA_MIM";
            if (isGroup) {
                try {
                    const meta = await sock.groupMetadata(remoteJid);
                    const eu = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j: string) => jidNormalizedUser(j));
                    const souAdmin = (meta?.participants || []).some((p: any) => p.admin && (eu.includes(jidNormalizedUser(p.id)) || eu.includes(jidNormalizedUser(p.phoneNumber || p.jid || ""))));
                    if (souAdmin) modo = "TODOS";
                } catch { /* sem metadados: fica "so para mim" */ }
            }
        }

        marcarApagandoPeloPainel(messageId);
        if (modo === "TODOS") {
            await sock.sendMessage(remoteJid, { delete: key });
        } else if (sincronizaEstadoChat()) {
            await sock.chatModify({
                deleteForMe: { deleteMedia: false, key, timestamp: Math.floor((msg?.timestamp?.getTime() || Date.now()) / 1000) }
            }, remoteJid);
        }
        // minha versao: sem SINCRONIZAR_ESTADO_CHAT nenhum chatModify sai (um envio malformado pode deslogar a conta):
        // "so para mim" vira apagar so no ZapHub (auditoria + banco), e o aviso diz isso

        // auditoria + some do painel (o conteudo fica so no registro)
        if (msg && dbSession) {
            await registrarApagada({
                sessionKey: sessionId,
                dbSessionId: dbSession.id,
                mensagem: msg,
                origem: "PAINEL",
                modo,
                usuarioId: user.id,
                usuarioNome: (user as any).name || (user as any).email || user.id,
            });
            await prisma.message.delete({ where: { id: msg.id } }).catch(() => {});
            (global as any).io?.to(sessionId).emit("message.removed", { sessionKey: sessionId, keyId: messageId, remoteJid });
        }

        return NextResponse.json({
            status: true,
            modo,
            message: modo === "TODOS" ? "Mensagem apagada para todos"
                : sincronizaEstadoChat() ? "Mensagem de outra pessoa: o WhatsApp só permite apagar para você"
                : "Apagada só no ZapHub (o WhatsApp do celular continua com ela)",
        });

    } catch (error: any) {
        console.error("Delete message error:", error);

        if (error.message?.includes("too old") || error.message?.includes("time limit")) {
            return NextResponse.json({ status: false, message: "Mensagem antiga demais para apagar para todos", error: "Mensagem antiga demais para apagar para todos" }, { status: 400 });
        }

        return NextResponse.json({ status: false, message: "Falha ao apagar a mensagem", error: "Falha ao apagar a mensagem" }, { status: 500 });
    }
}

// PATCH: Edit a sent message
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string; messageId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid, messageId } = await params;
        const body = await request.json().catch(() => ({}));
        const { text } = body;

        if (!text) {
            return NextResponse.json({ status: false, message: "Text is required to edit message", error: "Bad Request" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);

        await instance.socket.sendMessage(decodedJid, {
            text: text,
            edit: {
                remoteJid: decodedJid,
                id: messageId,
                fromMe: true
            }
        });

        return NextResponse.json({ status: true, message: "Message edited successfully" });
    } catch (error: any) {
        console.error("Edit message error:", error);
        return NextResponse.json({ status: false, message: "Failed to edit message", error: error.message || "Failed to edit message" }, { status: 500 });
    }
}
