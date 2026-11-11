import { auth } from "@/lib/auth";
import { validateApiKey } from "@/lib/api-auth";
import { origemReal } from "@/auth.config";
import { VERSAO_TERMOS } from "@/lib/termos";
import { bloqueadaNaDemo, MENSAGEM_DEMO } from "@/lib/demo";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// minha versao: LGPD — o usuario com sessao precisa ter aceito a versao ATUAL dos termos.
// Liberado mesmo sem aceite: o proprio aceite (/api/me/termos), a leitura da config publica do sistema e /api/auth/*.
function termosPendentes(session: { user?: { termosVersao?: string | null } } | null): boolean {
    return (session?.user?.termosVersao ?? null) !== VERSAO_TERMOS;
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Public routes that don't require authentication
    const publicRoutes = ["/auth/login", "/auth/register", "/api/auth", "/terms", "/privacy"];

    // Check if it's a public route
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    // Allow Next.js internals and favicon only
    if (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico"
    ) {
        return NextResponse.next();
    }

    // Allow known static asset extensions in root path only (e.g. /vercel.svg)
    // minha versao: .crt (certificado PUBLICO da CA local, para instalar antes do login) e o instalador .bat
    // minha versao: .webmanifest (manifesto do app, com os icones novos)
    const staticExtensions = [".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf", ".crt", ".bat", ".webmanifest"];
    if (pathname.lastIndexOf("/") === 0 && staticExtensions.some(ext => pathname.endsWith(ext))) {
        return NextResponse.next();
    }

    // minha versao: modo demonstracao — nada e alterado pela API (ver src/lib/demo.ts)
    if (bloqueadaNaDemo(request.method, pathname)) {
        return NextResponse.json({ status: false, error: "demo", message: MENSAGEM_DEMO }, { status: 403 });
    }

    // API routes: Check for valid API key or session
    if (pathname.startsWith("/api/")) {
        // Skip auth endpoints
        if (pathname.startsWith("/api/auth")) {
            return NextResponse.next();
        }

        // Check for API key in header
        const apiKey = request.headers.get("x-api-key");
        if (apiKey) {
            // Defense-in-depth: validate API key immediately
            const user = await validateApiKey(request);
            if (!user) {
                return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
            }
            return NextResponse.next();
        }

        // Check for session auth
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (termosPendentes(session)) {
            const liberada = pathname === "/api/me/termos" || (pathname === "/api/settings/system" && request.method === "GET");
            if (!liberada) {
                return NextResponse.json({ status: false, error: "termos_pendentes", message: "Aceite os termos para continuar" }, { status: 403 });
            }
        }

        return NextResponse.next();
    }

    // Dashboard routes: Require login
    if (pathname.startsWith("/dashboard")) {
        const session = await auth();

        if (!session?.user) {
            const loginUrl = new URL("/auth/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return NextResponse.redirect(loginUrl);
        }

        if (termosPendentes(session)) {
            const aceite = new URL("/aceite", origemReal(request, request.nextUrl));
            aceite.searchParams.set("callbackUrl", pathname);
            return NextResponse.redirect(aceite);
        }

        return NextResponse.next();
    }

    // Root path — redirect to dashboard if logged in
    if (pathname === "/") {
        const session = await auth();
        if (session?.user) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
    }

    // Public routes
    if (isPublicRoute) {
        const session = await auth();
        if (session?.user && (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/register"))) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
    }

    // Default: require auth for everything else
    const session = await auth();
    if (!session?.user) {
        const loginUrl = new URL("/auth/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico).*)",
    ],
};
