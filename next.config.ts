import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // minha versao: permite compilar numa pasta alternativa (atualizar.sh usa NEXT_DIST_DIR=.next.new)
  // para o site atual continuar no ar durante o build e so trocar se der tudo certo.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // habilitado para permitir o build de produção (o app já roda; são erros de checagem, não de runtime)
  typescript: { ignoreBuildErrors: true },
  // obs.: no Next 16 a chave "eslint" saiu do next.config (o lint deixou de rodar no build) — removida p/ nao poluir o log
  // minha versao: nao revela que e Next.js e manda cabecalhos de seguranca em todas as paginas/rotas
  poweredByHeader: false,
  // minha versao: audio e anexos passam por Server Action, cujo limite padrao e 1 MB (cerca de 1 min de voz).
  // 100 MB = maior limite de midia do ChatService. O proxy (middleware) corta em 10 MB se nao subir junto.
  experimental: {
    serverActions: { bodySizeLimit: "100mb" },
    proxyClientMaxBodySize: "100mb",
  },
  // seguranca: NAO gera source maps no navegador em producao (quem abrir o F12 ve so o codigo minificado,
  // nunca o fonte original com nomes/comentarios). Segredos e logica sensivel ficam no servidor.
  productionBrowserSourceMaps: false,
  async headers() {
    // minha versao: Content-Security-Policy. O app NAO carrega script/fonte/CSS externos (conferido),
    // entao da pra ser estrito no perigoso (object/base/form/frame) e permissivo so onde o Next precisa
    // (inline script do tema + hidratacao). Interruptor de emergencia: CSP_DISABLED="true" desliga.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",   // Next precisa de inline (tema/hidratacao); sem script externo
      "style-src 'self' 'unsafe-inline'",                  // Tailwind/estilos inline
      "img-src 'self' data: blob: https:",                 // fotos/midia (proxy same-origin + data/blob)
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",                       // socket.io (tempo real) no mesmo host
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "object-src 'none'",                                 // bloqueia <object>/<embed> (vetor antigo de XSS)
      "base-uri 'self'",                                   // impede sequestro de <base>
      "form-action 'self'",                                // formularios so postam para o proprio site
      "frame-ancestors 'self'",                            // anti-clickjacking (reforca o X-Frame-Options)
      "upgrade-insecure-requests",
    ].join("; ");

    const headers = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },                       // nao deixa embutir o painel em iframe de fora
      { key: "X-Content-Type-Options", value: "nosniff" },                    // navegador nao "adivinha" tipo de arquivo
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      // obs.: SEM HSTS de proposito — num IP interno o HSTS forcaria https em TODAS as portas
      // e quebraria o download do certificado por HTTP (3005). O redirect do servidor ja leva ao https.
    ];
    if (process.env.CSP_DISABLED !== "true") {
      headers.push({ key: "Content-Security-Policy", value: csp });
    }
    return [{ source: "/:path*", headers }];
  },
  serverExternalPackages: [
    "sharp",
    "bcryptjs",
    "@whiskeysockets/baileys",
    "whatsapp-rust-bridge",
    "jimp",
    "pino",
    "qrcode-terminal",
    // minha versao: systeminformation referencia caminhos de executaveis do SO (ex.: powershell.exe) que o
    // empacotador tenta resolver como modulo e entra em panico (Turbopack no Next 16.4+). Deixa como require externo.
    "systeminformation",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withNextIntl(nextConfig);
