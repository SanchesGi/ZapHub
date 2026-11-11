import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin, podeGerenciarUsuarios } from "@/lib/api-auth";
import { validarSenhaForte } from "@/lib/senha";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createUserSchema = z.object({
    name: z.string().min(2).max(100),
    email: z.string().email().max(254),
    password: z.string().min(4).max(200),
    role: z.enum(["SUPERADMIN", "STAFF", "USER"]).default("USER"),
    supervisorId: z.string().max(64).optional().nullable(), // minha versao: Supervisor responsavel (Equipe)
});

// minha versao: Super Administrador e Supervisor gerenciam usuarios.
// Supervisor: ve Equipe e Supervisores (nao os Super Administradores), sem a contagem de sessoes de cada um
// (para nao expor quem tem WhatsApp pessoal), e so cria usuarios "Equipe".
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);

    if (!user || !podeGerenciarUsuarios(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }
    const admin = isAdmin(user.role);

    try {
        const users = await prisma.user.findMany({
            // Supervisor: so a equipe dele (e ele mesmo)
            where: admin ? undefined : { OR: [{ supervisorId: user.id }, { id: user.id }] },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                supervisorId: true,
                supervisor: { select: { id: true, name: true, email: true } },
                ...(admin ? { _count: { select: { sessions: true } } } : {})
            }
        });

        return NextResponse.json({ status: true, message: "Users fetched successfully", data: users });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch users", error: "Failed to fetch users" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);

    if (!user || !podeGerenciarUsuarios(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    try {
        const body = await request.json();
        const parseResult = createUserSchema.safeParse(body);

        if (!parseResult.success) {
            return NextResponse.json({ status: false, message: "Validation error", error: parseResult.error.flatten() }, { status: 400 });
        }

        const { name, email, password, role } = parseResult.data;
        const forte = validarSenhaForte(password);
        if (!forte.ok) return NextResponse.json({ status: false, message: forte.motivo, error: forte.motivo }, { status: 400 });
        // Supervisor: quem ele cria entra na equipe dele. Admin: escolhe (precisa ser um Supervisor)
        let supervisorId: string | null = null;
        if (!isAdmin(user.role)) supervisorId = user.id;
        else if (parseResult.data.supervisorId) {
            const sup = await prisma.user.findUnique({ where: { id: parseResult.data.supervisorId }, select: { role: true } });
            if (sup?.role !== "STAFF") return NextResponse.json({ status: false, message: "O responsável precisa ser um Supervisor", error: "Bad Request" }, { status: 400 });
            supervisorId = parseResult.data.supervisorId;
        }

        // Supervisor so cria Equipe
        if (!isAdmin(user.role) && role !== "USER") {
            return NextResponse.json({ status: false, message: "Supervisor só pode criar usuários da Equipe", error: "Forbidden" }, { status: 403 });
        }

        // Check if email exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return NextResponse.json({ status: false, message: "Email already exists", error: "Email already exists" }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: role as any,
                supervisorId: role === "USER" ? supervisorId : null
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true
            }
        });

        await registrarAcesso({ tipo: "USUARIO_CRIADO", usuarioId: user.id, usuarioEmail: user.email, alvo: email, ip: ipDeHeaders(request.headers), detalhe: `papel ${role}` });
        return NextResponse.json({ status: true, message: "User created successfully", data: newUser }, { status: 201 });

    } catch (error) {
        console.error("Create user error:", error);
        return NextResponse.json({ status: false, message: "Failed to create user", error: "Failed to create user" }, { status: 500 });
    }
}
