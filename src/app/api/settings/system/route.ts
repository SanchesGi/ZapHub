import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // @ts-ignore
        const config = await prisma.systemConfig.findUnique({
            where: { id: "default" }
        });

        // minha versao: a pasta das midias e assunto da Manutencao (so Super Administrador), nao vai aqui
        const { pastaMidia: _pasta, retencaoMensagensDias: _r1, retencaoMidiasDias: _r2, retencaoLogsDias: _r3, ...publica } = (config || {}) as any;
        return NextResponse.json({ status: true, message: "System config fetched", data: config ? publica : { appName: "ZapHub", faviconUrl: "/favicon.ico" } });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch settings", error: "Failed to fetch settings" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        // @ts-ignore
        const user = await getAuthenticatedUser(req);
        if (!user || user.role !== "SUPERADMIN") {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { appName, logoUrl, faviconUrl, timezone, enableRegistration } = body;

        // @ts-ignore
        const config = await prisma.systemConfig.upsert({
            where: { id: "default" },
            update: { appName, logoUrl, faviconUrl, timezone, enableRegistration: enableRegistration ?? true },
            create: { id: "default", appName, logoUrl: logoUrl || "", faviconUrl: faviconUrl || "/favicon.ico", timezone: timezone || "America/Sao_Paulo", enableRegistration: enableRegistration ?? true }
        });

        return NextResponse.json({ status: true, message: "System settings updated", data: config });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to update settings", error: "Failed to update settings" }, { status: 500 });
    }
}
