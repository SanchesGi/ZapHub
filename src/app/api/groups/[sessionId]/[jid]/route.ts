import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// GET: Get group details
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);

        // Check verification
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
             return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
             return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Fetch Group Metadata
        let metadata;
        try {
            metadata = await instance.socket.groupMetadata(decodedJid);
        } catch (e) {
            console.error("Failed to fetch group metadata:", e);
             return NextResponse.json({ status: false, message: "Failed to fetch group metadata. Ensure the bot is in the group.", error: "Failed to fetch group metadata. Ensure the bot is in the group." }, { status: 404 });
        }

        // Fetch Profile Picture
        let ppUrl = null;
        try {
            ppUrl = await instance.socket.profilePictureUrl(decodedJid, 'image');
        } catch (e) {
            // Ignore error if no PP
        }

        // minha versao: membros com nome e telefone resolvidos (inclusive @lid via Contact.lid)
        let participantsInfo: any[] = [];
        const parts: any[] = Array.isArray((metadata as any)?.participants) ? (metadata as any).participants : [];
        const sessionData = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (sessionData && parts.length) {
            const ids = parts.map((p) => p.id).filter(Boolean);
            const alts = parts.map((p) => p.phoneNumber || p.jid).filter(Boolean);
            const contacts = await prisma.contact.findMany({
                where: { sessionId: sessionData.id, OR: [{ jid: { in: [...ids, ...alts] } }, { lid: { in: ids } }] },
                select: { jid: true, lid: true, name: true, notify: true, verifiedName: true }
            });
            const byJid = new Map(contacts.map((c) => [c.jid, c]));
            const byLid = new Map(contacts.filter((c) => c.lid).map((c) => [c.lid as string, c]));
            const isPhone = (j?: string | null) => !!j && String(j).endsWith("@s.whatsapp.net");
            participantsInfo = parts.map((p) => {
                const alt = p.phoneNumber || p.jid || null;
                const c: any = byJid.get(p.id) || byLid.get(p.id) || (alt ? byJid.get(alt) : undefined);
                const phoneJid = isPhone(p.id) ? p.id : isPhone(alt) ? alt : isPhone(c?.jid) ? c.jid : null;
                return {
                    id: p.id,
                    admin: p.admin || null,
                    name: c?.name || c?.notify || c?.verifiedName || null,
                    phone: phoneJid ? String(phoneJid).split("@")[0] : null
                };
            });
        }

        return NextResponse.json({
            ...metadata,
            pictureUrl: ppUrl,
            participantsInfo
        });

    } catch (error) {
        console.error("Get group details error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
