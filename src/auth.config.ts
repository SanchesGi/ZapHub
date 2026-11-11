import type { NextAuthConfig } from "next-auth";

// minha versao: endereco REAL que o navegador usou (IP/nome da maquina na rede). O servidor custom do Next monta
// a URL interna de toda requisicao como http://localhost:3005, e o padrao do Auth.js (return false) colocava esse
// localhost no callbackUrl -> quem entrava pelo IP caia no "localhost" do proprio computador depois do login.
export function origemReal(request: Request, fallback: URL): string {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = (request.headers.get("x-forwarded-proto") ?? fallback.protocol).replace(/:$/, "");
    return host ? `${proto}://${host}` : fallback.origin;
}

export const authConfig = {
    pages: {
        signIn: '/auth/login',
    },
    callbacks: {
        authorized({ auth, request }) {
            const { nextUrl } = request;
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
            const base = origemReal(request, nextUrl);

            if (isOnDashboard) {
                if (isLoggedIn) return true;
                // login no MESMO endereco, voltando para o caminho pedido (relativo)
                const login = new URL('/auth/login', base);
                login.searchParams.set('callbackUrl', nextUrl.pathname + nextUrl.search);
                return Response.redirect(login);
            } else if (isLoggedIn && nextUrl.pathname === '/auth/login') {
                return Response.redirect(new URL('/dashboard', base));
            }
            return true;
        },
        async jwt({ token, user, trigger }) {
            if (user) {
                token.id = user.id;
                token.role = (user as any).role;
                // minha versao: LGPD — versao dos termos que o usuario aceitou (o proxy bloqueia se for diferente da atual)
                token.termosVersao = (user as any).termosVersao ?? null;
            }
            // minha versao: depois do aceite o front chama update(); NAO confia no que o cliente mandou: le do banco
            if (trigger === "update" && token.id) {
                try {
                    const { prisma } = await import("@/lib/prisma");
                    const u = await prisma.user.findUnique({ where: { id: token.id as string }, select: { termosVersao: true } });
                    token.termosVersao = u?.termosVersao ?? null;
                } catch { /* mantem o valor anterior */ }
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string;
                (session.user as any).role = token.role;
                session.user.termosVersao = (token.termosVersao as string | null | undefined) ?? null;
            }
            return session;
        }
    },
    providers: [], // Configured in auth.ts
    session: {
        strategy: 'jwt'
    },
    trustHost: true,
} satisfies NextAuthConfig;
