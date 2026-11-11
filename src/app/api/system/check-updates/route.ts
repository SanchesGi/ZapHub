import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { verificarAtualizacao } from "@/lib/atualizacao";

// minha versao: checa atualizacao no SEU repositorio (o origin do clone), via git local.
// So Super Administrador. Respeita ENABLE_AUTO_UPDATE_CHECK. Avisa 1x por versao nova.
export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Somente administradores" }, { status: 403 });
    if (process.env.ENABLE_AUTO_UPDATE_CHECK === "false") {
        return NextResponse.json({ status: true, message: "Checagem desligada", data: { disponivel: false } });
    }

    try {
        const info = await verificarAtualizacao(true);
        if (!info.disponivel) {
            return NextResponse.json({ status: true, message: "Sistema atualizado", data: info });
        }

        const curto = (info.remotoSha || "").slice(0, 7);
        const title = `Atualização disponível (${curto})`;
        const href = info.url ? `${info.url}/commits/main` : null;

        // avisa so uma vez por versao nova
        const existing = await prisma.notification.findFirst({ where: { userId: user.id, title } });
        if (!existing) {
            const notification = await prisma.notification.create({
                data: {
                    userId: user.id,
                    title,
                    message: `Há ${info.atras} atualização(ões) nova(s) em ${info.repo || "origin"}. Para instalar: Manutenção > Sistema > Atualizar agora. Com a atualização automática ligada, o servidor instala sozinho em até 5 minutos. O que mudou está no CHANGELOG do projeto.`,
                    type: "SYSTEM",
                    href: href || undefined,
                },
            });
            const io = (global as any).io;
            io?.to(`user:${user.id}`).emit("notification:new", {
                id: notification.id, userId: user.id, title, message: notification.message,
                type: "SYSTEM", href, createdAt: notification.createdAt,
            });
        }

        return NextResponse.json({ status: true, message: "Atualização disponível", data: info });
    } catch (e) {
        console.error("check-updates:", e);
        return NextResponse.json({ status: false, message: "Erro ao checar atualização" }, { status: 500 });
    }
}

// status rapido (sem criar aviso) para a interface
export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== "SUPERADMIN") return NextResponse.json({ status: false }, { status: 403 });
    const info = await verificarAtualizacao(false);
    return NextResponse.json({ status: true, data: info });
}
