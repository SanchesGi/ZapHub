import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { estaBloqueado, registrarFalha, registrarFalhaLogin, limparFalhas } from "@/lib/login-rate";
import { chaveDeBloqueio } from "@/lib/demo";
import { verificarCodigoUnico } from "@/lib/dois-fatores";
import { registrarAcesso, ipDeHeaders } from "@/lib/log-acesso";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // minha versao: codigo do app autenticador (so quem ativou o 2FA precisa)
        totp: { label: "Código 2FA", type: "text" },
      },
      authorize: async (credentials, request) => {
        const ip = ipDeHeaders((request as any)?.headers);
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(1) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const chave = chaveDeBloqueio(email, ip);

          // minha versao: trava anti-forca-bruta (bloqueia o e-mail apos varios erros)
          if (estaBloqueado(chave)) {
            await registrarAcesso({ tipo: "LOGIN_FALHA", usuarioEmail: email, ip, detalhe: "bloqueado (muitas tentativas)" });
            return null;
          }

          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) {
            registrarFalhaLogin(chave);
            await registrarAcesso({ tipo: "LOGIN_FALHA", usuarioEmail: email, ip, detalhe: "usuario inexistente" });
            return null;
          }

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
             // minha versao: 2FA so para quem ativou (SUPERADMIN). Sem 2FA, login segue igual ao de antes.
             if (user.twoFactorEnabled && user.twoFactorSecret) {
               const codigo = String((credentials as any)?.totp || "");
               if (!verificarCodigoUnico(user.id, codigo, user.twoFactorSecret)) {
                 registrarFalha(chave); // codigo errado conta como tentativa
                 await registrarAcesso({ tipo: "LOGIN_2FA_FALHA", usuarioId: user.id, usuarioEmail: email, ip });
                 return null;
               }
             }
             limparFalhas(chave);
             await registrarAcesso({ tipo: "LOGIN_OK", usuarioId: user.id, usuarioEmail: email, ip, detalhe: user.twoFactorEnabled ? "com 2FA" : null });
             return user;
          }
          registrarFalhaLogin(chave);
          await registrarAcesso({ tipo: "LOGIN_FALHA", usuarioId: user.id, usuarioEmail: email, ip, detalhe: "senha incorreta" });
        }
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
});
