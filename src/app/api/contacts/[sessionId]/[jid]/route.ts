import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

// GET: informações completas de um contato (minha versao)
// Junta o que está no banco (nome salvo, notify, ligação @lid <-> telefone) com o que vem ao vivo do WhatsApp
// (recado/status, foto e perfil comercial).
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        const { sessionId, jid } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }
        const decodedJid = decodeURIComponent(jid);

        const sessionData = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // contato direto + o "irmão" ligado pelo lid (telefone <-> @lid)
        const direct = await prisma.contact.findUnique({ where: { sessionId_jid: { sessionId: sessionData.id, jid: decodedJid } } });
        let linked: any = null;
        if (decodedJid.endsWith("@lid")) {
            linked = await prisma.contact.findFirst({ where: { sessionId: sessionData.id, lid: decodedJid } });
        } else if (direct?.lid) {
            linked = await prisma.contact.findFirst({ where: { sessionId: sessionData.id, jid: direct.lid } });
        }

        const isPhone = (j?: string | null) => !!j && j.endsWith("@s.whatsapp.net");
        const phoneJid = isPhone(decodedJid) ? decodedJid
            : isPhone(linked?.jid) ? linked.jid
            : isPhone(direct?.remoteJidAlt) ? direct!.remoteJidAlt
            : null;

        let about: string | null = null;
        let aboutAt: string | null = null;
        let pictureUrl: string | null = null;
        let business: any = null;
        // ?leve=1 -> so o banco (usado pelo aviso "nao esta na agenda" ao abrir a conversa)
        const leve = new URL(req.url).searchParams.get("leve") === "1";
        const sock: any = leve ? null : waManager.getInstance(sessionId)?.socket;
        if (sock) {
            const alvo = phoneJid || decodedJid;
            try {
                const r: any = await sock.fetchStatus(alvo);
                const first = Array.isArray(r) ? r[0] : r;
                const st = first?.status ?? first;
                about = typeof st === "string" ? st : (st?.status ?? null);
                const quando = st?.setAt ?? first?.setAt;
                aboutAt = quando ? new Date(quando).toISOString() : null;
            } catch { /* sem recado ou privado */ }
            try { pictureUrl = await sock.profilePictureUrl(decodedJid, "image"); } catch { /* sem foto */ }
            try {
                const b = await sock.getBusinessProfile(alvo);
                if (b) business = { description: b.description || null, category: b.category || null, email: b.email || null, website: b.website || null, address: b.address || null };
            } catch { /* não é conta comercial */ }
        }

        const messageCount = leve ? 0 : await prisma.message.count({ where: { sessionId: sessionData.id, remoteJid: decodedJid } });

        return NextResponse.json({
            status: true,
            data: {
                jid: decodedJid,
                phone: phoneJid ? phoneJid.split("@")[0] : null,
                name: direct?.name || linked?.name || null,
                notify: direct?.notify || linked?.notify || null,
                verifiedName: direct?.verifiedName || linked?.verifiedName || null,
                about,
                aboutAt,
                pictureUrl,
                business,
                isLid: decodedJid.endsWith("@lid"),
                saved: !!(direct?.name || linked?.name),
                messageCount
            }
        });
    } catch (error) {
        console.error("Error fetching contact info:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
