
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { batchResolveToPhoneJid } from "@/lib/jid-utils";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limitParam = searchParams.get("limit") || "10";
        const isAll = limitParam === "all";
        const limit = isAll ? 0 : parseInt(limitParam) || 10;
        const search = searchParams.get("search") || "";

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Resolve sessionId string to database ID (CUID)
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const where: any = {
            sessionId: sessionData.id,
        };

        // minha versao: ?agenda=1 -> so contatos com telefone (@s.whatsapp.net) e nome salvo;
        // ?agenda=todos -> com telefone e algum nome (salvo ou o nome de perfil)
        const agenda = searchParams.get("agenda");
        if (agenda) {
            where.jid = { endsWith: "@s.whatsapp.net" };
            where.AND = agenda === "todos"
                ? [{ OR: [{ name: { not: null } }, { notify: { not: null } }] }]
                : [{ name: { not: null } }, { NOT: { name: "" } }];
        }

        if (search) {
            const digitos = search.replace(/\D/g, "");
            where.OR = [
                { name: { contains: search } },
                { notify: { contains: search } },
                { verifiedName: { contains: search } },
                { jid: { contains: search } },
                { remoteJidAlt: { contains: search } },
                // "(46) 99999-8888" tambem acha pelo numero
                ...(digitos.length >= 3 && digitos !== search ? [{ jid: { contains: digitos } }] : [])
            ];
        }

        const [contacts, total] = await Promise.all([
            prisma.contact.findMany({
                where,
                ...(isAll ? {} : { skip: (page - 1) * limit, take: limit }),
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: { messages: true }
                    }
                }
            }),
            prisma.contact.count({ where })
        ]);

        return NextResponse.json({
            status: true,
            message: "Contacts retrieved successfully",
            data: contacts,
            meta: {
                total,
                page: isAll ? 1 : page,
                limit: isAll ? total : limit,
                totalPages: isAll ? 1 : Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Error fetching contacts:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: adicionar / renomear contato (minha versao). Body: { jid, name }
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const jid = String(body?.jid || "").trim();
        const name = String(body?.name || "").trim();
        if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) {
            return NextResponse.json({ status: false, message: "jid inválido", error: "jid inválido" }, { status: 400 });
        }

        const sessionData = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const contact = await prisma.contact.upsert({
            where: { sessionId_jid: { sessionId: sessionData.id, jid } },
            update: name ? { name } : {},
            create: { sessionId: sessionData.id, jid, name: name || null }
        });

        // body.celular=true -> grava tambem na agenda do WhatsApp da conta (sincroniza com o celular)
        let celular: { ok: boolean; erro?: string } | null = null;
        if (body?.celular && name && jid.endsWith("@s.whatsapp.net")) {
            const sock: any = waManager.getInstance(sessionId)?.socket;
            if (!sock?.addOrEditContact) {
                celular = { ok: false, erro: "Sessão desconectada" };
            } else {
                try {
                    await sock.addOrEditContact(jid, {
                        fullName: name,
                        firstName: name.split(/\s+/)[0],
                        saveOnPrimaryAddressbook: true,
                        ...(contact.lid ? { lidJid: contact.lid } : {})
                    });
                    celular = { ok: true };
                } catch (e: any) {
                    console.error("addOrEditContact falhou:", e?.message || e);
                    celular = { ok: false, erro: e?.message || "falhou" };
                }
            }
        }
        return NextResponse.json({ status: true, message: "Contato salvo", data: contact, celular });
    } catch (error) {
        console.error("Error saving contact:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
