import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { VERSAO_TERMOS } from "@/lib/termos";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";
import { limitarTaxa, ipDoRequest, resposta429 } from "@/lib/rate-limit";

const registerSchema = z.object({
    name: z.string().min(2).max(100),
    email: z.string().email().max(254),
    password: z.string().min(6).max(200),
    // minha versao: LGPD — o aceite dos Termos/Privacidade e obrigatorio para criar a conta
    aceiteTermos: z.literal(true),
});

export async function POST(req: Request) {
    try {
        // rate-limit: no maximo 5 cadastros por IP a cada 10 min (contra abuso/spam)
        const rl = limitarTaxa(`register:${ipDoRequest(req)}`, 5, 10 * 60 * 1000);
        if (!rl.ok) return resposta429(rl.emSegundos);

        const body = await req.json();
        const { email, password, name } = registerSchema.parse(body);

        // Check user count to allow first user as SUPERADMIN
        const userCount = await prisma.user.count();

        if (userCount > 0) {
            // Check if registration is enabled
            const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
            if (!systemConfig || systemConfig.enableRegistration !== true) {
                return NextResponse.json(
                    { error: "Registration is currently disabled by the administrator" },
                    { status: 403 }
                );
            }
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "User with this email already exists" },
                { status: 400 }
            );
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // First user becomes SUPERADMIN, subsequent users are USER (least privilege)
        const assignedRole = userCount === 0 ? "SUPERADMIN" : "USER";

        // Create the user
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: assignedRole as any,
                termosVersao: VERSAO_TERMOS,
                aceitesTermos: {
                    create: { versao: VERSAO_TERMOS, ip: ipDeHeaders(req.headers), userAgent: (req.headers.get("user-agent") || "").slice(0, 500) || null },
                },
            },
        });
        await registrarAcesso({ tipo: "TERMOS_ACEITOS", usuarioId: newUser.id, usuarioEmail: newUser.email, ip: ipDeHeaders(req.headers), detalhe: `versao ${VERSAO_TERMOS} (cadastro)` });

        return NextResponse.json({
            success: true,
            message: "User registered successfully",
            user: { id: newUser.id, name: newUser.name, email: newUser.email },
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid registration data provided" },
                { status: 400 }
            );
        }

        console.error("Registration error:", error);
        return NextResponse.json(
            { error: "Internal server error during registration" },
            { status: 500 }
        );
    }
}
