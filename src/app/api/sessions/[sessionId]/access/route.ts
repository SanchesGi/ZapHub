import { NextResponse, NextRequest } from "next/server";
import { buscarSessao } from "@/lib/session-access";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, podeGerenciarSessao, podeGerenciarUsuarios } from "@/lib/api-auth";
import { z } from "zod";
import { tirarDaSessao } from "@/lib/revogar-socket";

const grantAccessSchema = z.object({
    email: z.string().email("Valid email is required"),
});

const revokeAccessSchema = z.object({
    userId: z.string().min(1, "User ID is required"),
});

// GET: List all users who have access to this session
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;

        // Only session owner or SUPERADMIN can view access list
        // minha versao: so Super Administrador e Supervisor (com acesso a sessao) adicionam/removem pessoas
        const isOwner = podeGerenciarUsuarios(user.role) && await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!isOwner) {
            return NextResponse.json({ status: false, message: "Sem permissão: só o Super Administrador ou um Supervisor que tenha acesso a esta sessão pode adicionar/remover pessoas nela" }, { status: 403 });
        }

        // Resolve sessionId slug to DB id
        const dbSession = await buscarSessao(sessionId, { id: true, sessionId: true, name: true, userId: true });

        if (!dbSession) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        const accessList = await prisma.sessionAccess.findMany({
            where: { sessionId: dbSession.id },
            include: {
                user: {
                    select: { id: true, name: true, email: true, role: true }
                }
            },
            orderBy: { createdAt: "desc" }
        });

        return NextResponse.json({
            status: true,
            message: "Access list retrieved successfully",
            data: accessList
        });
    } catch (error) {
        console.error("Get session access error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Grant access to another user by email
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;

        // Only session owner or SUPERADMIN can grant access
        // minha versao: so Super Administrador e Supervisor (com acesso a sessao) adicionam/removem pessoas
        const isOwner = podeGerenciarUsuarios(user.role) && await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!isOwner) {
            return NextResponse.json({ status: false, message: "Sem permissão: só o Super Administrador ou um Supervisor que tenha acesso a esta sessão pode adicionar/remover pessoas nela" }, { status: 403 });
        }

        const body = await request.json();
        const parseResult = grantAccessSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ status: false, message: "Validation error", error: parseResult.error.flatten() }, { status: 400 });
        }

        const { email } = parseResult.data;

        // Resolve session
        const dbSession = await buscarSessao(sessionId, { id: true, userId: true, name: true });

        if (!dbSession) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        // Find target user
        const targetUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true, role: true }
        });

        if (!targetUser) {
            return NextResponse.json({ status: false, message: "User not found with that email" }, { status: 404 });
        }

        // Prevent granting access to session owner (they already have full access)
        if (targetUser.id === dbSession.userId) {
            return NextResponse.json({ status: false, message: "Cannot grant access to the session owner" }, { status: 400 });
        }

        // minha versao: Supervisor so adiciona pessoas da PROPRIA equipe
        if (user.role === "STAFF" && targetUser.id !== user.id) {
            const alvo = await prisma.user.findUnique({ where: { id: targetUser.id }, select: { supervisorId: true } });
            if (alvo?.supervisorId !== user.id) {
                return NextResponse.json({ status: false, message: "Supervisor só adiciona pessoas da própria equipe" }, { status: 403 });
            }
        }

        // Prevent granting access to SUPERADMIN (they already have full access)
        if (targetUser.role === "SUPERADMIN") {
            return NextResponse.json({ status: false, message: "SUPERADMIN already has access to all sessions" }, { status: 400 });
        }

        // Check if access already exists
        const existing = await prisma.sessionAccess.findUnique({
            where: {
                sessionId_userId: {
                    sessionId: dbSession.id,
                    userId: targetUser.id
                }
            }
        });

        if (existing) {
            return NextResponse.json({ status: false, message: "User already has access to this session" }, { status: 409 });
        }

        // Create access
        const access = await prisma.sessionAccess.create({
            data: {
                sessionId: dbSession.id,
                userId: targetUser.id
            },
            include: {
                user: {
                    select: { id: true, name: true, email: true, role: true }
                }
            }
        });

        return NextResponse.json({
            status: true,
            message: `Access granted to ${targetUser.email}`,
            data: access
        }, { status: 201 });

    } catch (error) {
        console.error("Grant session access error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE: Revoke access from a user
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;

        // Only session owner or SUPERADMIN can revoke access
        // minha versao: so Super Administrador e Supervisor (com acesso a sessao) adicionam/removem pessoas
        const isOwner = podeGerenciarUsuarios(user.role) && await podeGerenciarSessao(user.id, user.role, sessionId);
        if (!isOwner) {
            return NextResponse.json({ status: false, message: "Sem permissão: só o Super Administrador ou um Supervisor que tenha acesso a esta sessão pode adicionar/remover pessoas nela" }, { status: 403 });
        }

        const body = await request.json();
        const parseResult = revokeAccessSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ status: false, message: "Validation error", error: parseResult.error.flatten() }, { status: 400 });
        }

        const { userId: targetUserId } = parseResult.data;

        // Resolve session
        const dbSession = await buscarSessao(sessionId, { id: true, sessionId: true });

        if (!dbSession) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        // Check if access record exists
        const existing = await prisma.sessionAccess.findUnique({
            where: {
                sessionId_userId: {
                    sessionId: dbSession.id,
                    userId: targetUserId
                }
            }
        });

        if (!existing) {
            return NextResponse.json({ status: false, message: "Access record not found" }, { status: 404 });
        }

        await prisma.sessionAccess.delete({
            where: { id: existing.id }
        });
        await tirarDaSessao(targetUserId, dbSession.sessionId).catch(() => {}); // minha versao: sai das salas na hora

        return NextResponse.json({
            status: true,
            message: "Access revoked successfully",
            data: null
        });

    } catch (error) {
        console.error("Revoke session access error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error" }, { status: 500 });
    }
}
