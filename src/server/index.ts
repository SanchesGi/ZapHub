import { loadEnvConfig } from "@next/env";
// Load environment variables before any other imports/logic
loadEnvConfig(process.cwd());
// minha versao: ultimas linhas do console na memoria, para o painel (Manutencao > Logs)
import { instalarRegistroMemoria } from "../lib/registro-memoria";
instalarRegistroMemoria();

import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import os from "os";
import fs from "fs";
import path from "path";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { setupSocket } from "./socket";
import { waManager } from "../modules/whatsapp/manager";
import { logger } from "../lib/logger";
import { runAutoMigration } from "../lib/auto-migrate";
import { MODO_DEMO } from "../lib/demo";
import { definirIpDoCliente } from "../lib/ip-cliente";
import pkg from "../../package.json";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3030", 10);

const INSECURE_AUTH_SECRETS = [
  "change-me",
  "secret",
  "your-super-secret-key-at-least-32-chars-change-this-in-production",
  "troque-por-um-segredo-gerado-com-openssl-rand-base64-32", // minha versao: valor de exemplo do .env.example atual
  "your-secret-here",
  "YOUR_AUTH_SECRET_HERE",
  "changethis",
  "default_secret"
];

if (!process.env.AUTH_SECRET || INSECURE_AUTH_SECRETS.includes(process.env.AUTH_SECRET)) {
  if (!dev) {
    logger.error("Server", "FATAL: AUTH_SECRET is unset or using an insecure placeholder! Please generate a strong secret with: openssl rand -base64 32");
    process.exit(1);
  } else {
    logger.warn("Server", "WARNING: AUTH_SECRET is unset or using a default placeholder. Please update it before deploying to production!");
  }
}

// On NTFS filesystems (e.g. /media/... partitions), Turbopack dev chunk naming containing colons
// causes OS Error 22 (EINVAL). Default custom server to webpack unless TURBOPACK=1 is explicitly enabled.
const useTurbopack = process.env.TURBOPACK === "1" || process.env.TURBO === "true";
// minha versao: SEM `hostname` aqui. Com ele, o Next monta a URL de cada pagina com "localhost" fixo
// (o callbackUrl do login apontava para localhost para quem entrava pelo IP da rede). Sem ele, usa o Host
// que o navegador mandou (o IP/nome que a pessoa digitou).
const app = next({
  dev,
  port,
  ...(dev ? (useTurbopack ? { turbopack: true } : { webpack: true }) : {})
});
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Run runtime database migrations directly on application start
  await runAutoMigration();

  const atender = async (req: any, res: any) => {
    try {
      if (!req.url) return;
      definirIpDoCliente(req); // minha versao: IP real do socket (X-Forwarded-For so com TRUST_PROXY=true)
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error("Server", "Error handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  };
  // minha versao: HTTPS na rede (HTTPS_PORT, padrao 3443) com o certificado da CA local em ./certificados.
  // Necessario para notificacao do Windows funcionar fora do localhost (o navegador so libera em contexto seguro).
  const pastaCert = path.join(process.cwd(), "certificados");
  const portaHttps = parseInt(process.env.HTTPS_PORT || "3443", 10);
  let serverHttps: ReturnType<typeof createHttpsServer> | null = null;
  if (process.env.HTTPS_DISABLED !== "true" && fs.existsSync(path.join(pastaCert, "servidor.key")) && fs.existsSync(path.join(pastaCert, "servidor.crt"))) {
    serverHttps = createHttpsServer({
      key: fs.readFileSync(path.join(pastaCert, "servidor.key")),
      cert: Buffer.concat([fs.readFileSync(path.join(pastaCert, "servidor.crt")), Buffer.from("\n"), fs.readFileSync(path.join(pastaCert, "ca.crt"))]),
    }, atender);
  }

  // minha versao: com o HTTPS ativo, a porta HTTP manda todo mundo para o HTTPS (seguro, sem aviso de contexto).
  // Exceção: o download do certificado precisa SAIR por HTTP (senao vira ovo-e-galinha). Desliga com HTTP_REDIRECT_HTTPS=false.
  const atenderHttp = async (req: any, res: any) => {
    const u: string = req.url || "/";
    const ehDownloadCert = ["/certificado-zaphub.crt", "/instalar-certificado-zaphub.bat"]
        .some((p) => u.startsWith(p));
    if (serverHttps && !ehDownloadCert && process.env.HTTP_REDIRECT_HTTPS !== "false") {
      const host = String(req.headers.host || hostname).split(":")[0];
      res.writeHead(308, { Location: `https://${host}:${portaHttps}${u}` });
      res.end();
      return;
    }
    return atender(req, res);
  };
  const server = createServer(atenderHttp);

  const allowedOrigin = process.env.BASE_URL || `http://${hostname}:${port}`;
  // minha versao: tempo real tambem para quem acessa pelo IP/nome da maquina na rede local
  // (antes so localhost: no outro computador o painel abria, mas as mensagens ao vivo "caiam")
  const nomeMaquina = os.hostname().toLowerCase();
  const daRedeLocal = (origin: string) => {
    try {
      const h = new URL(origin).hostname.toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]"
        || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
        || h === nomeMaquina || h.startsWith(nomeMaquina + ".") || h.endsWith(".local") || h.endsWith(".lan") || !h.includes(".");
    } catch { return false; }
  };
  const io = new Server(server, {
    path: "/api/socket/io",
    addTrailingSlash: false,
    cors: {
      origin: (origin, callback) => {
        if (
          !origin ||
          origin === allowedOrigin ||
          daRedeLocal(origin) ||
          origin === process.env.NEXTAUTH_URL
        ) {
          callback(null, true);
        } else {
          callback(new Error("CORS origin denied"));
        }
      },
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  // o mesmo socket.io (mesmas salas/eventos) atende tambem o HTTPS
  if (serverHttps) io.attach(serverHttps);

  setupSocket(io);
  // Optional: Global instance for Baileys to emit events
  (global as any).io = io;

  // Initialize WhatsApp Manager
  // minha versao: as sessoes do WhatsApp so conectam DEPOIS que a porta foi reservada (server.listen abaixo).
  // Antes conectavam primeiro: um 2o processo aberto por engano (com o servico ja rodando)
  // conectava as mesmas sessoes, derrubava as do processo principal ("conflict: replaced") e so depois morria.
  waManager.setup(io);
  // minha versao: nesta instalacao SO a porta HTTPS e alcançavel de fora (firewall externo que nao controlo)
  // e ha OUTRO projeto rodando no mesmo servidor (root). Entao o HTTPS (3443) e o servidor PRINCIPAL da rede;
  // o HTTP fica apenas no localhost (checagem interna) e NUNCA derruba o app se a porta ja estiver em uso.
  server.keepAliveTimeout = 120 * 1000; // 120s (Cloudflare 520 fix: nao derruba conexao ociosa reutilizada)
  server.headersTimeout = 120 * 1000;

  // o que roda assim que o servidor principal sobe (sessoes do WhatsApp, agendador e heartbeat)
  const aoSubir = () => {
    // minha versao: na demonstracao nenhum WhatsApp e conectado (e o status das sessoes do banco fica como esta)
    if (MODO_DEMO) logger.info("Demo", "Modo demonstracao: nenhum WhatsApp sera conectado; alteracoes e envios sao recusados.");
    else waManager.loadSessions().catch((e) => logger.error("Manager", "Falha ao carregar as sessoes", e));
    // minha versao: o agendador e o lib/cron.ts (iniciado pelo WhatsAppManager). O antigo modules/whatsapp/scheduler.ts
    // procurava a sessao pelo id errado (nunca enviava) e foi removido para nao duplicar envio se alguem corrigisse o id.

    // minha versao: removida a "telemetria" herdada, que mandava a cada 30 s nome, versao e dados do servidor
    // para um servidor do autor original. Nenhum dado sai desta instalacao sem o administrador configurar.
  };

  if (serverHttps) {
    // HTTPS = servidor principal (rede). Se a porta 3443 ja estiver em uso, aí sim e fatal.
    serverHttps.keepAliveTimeout = 120 * 1000;
    serverHttps.headersTimeout = 120 * 1000;
    serverHttps.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        logger.error("Server", `A porta HTTPS ${portaHttps} ja esta em uso (ZapHub ja rodando ou outro servico usa ela). Saindo.`);
        process.exit(2);
      }
      logger.error("Server", "Erro no servidor HTTPS", err);
    });
    serverHttps.listen(portaHttps, () => {
      logger.banner(pkg.name.toUpperCase(), pkg.version, portaHttps);
      logger.success("Server", `HTTPS ativo na porta ${portaHttps} (rede). Certificado em ./certificados`);
      aoSubir();
    });

    // HTTP so no localhost (checagem interna/health). Se a porta estiver ocupada pelo outro projeto, IGNORA.
    server.on("error", (err: any) => logger.warn("Server", `HTTP interno (porta ${port}) nao subiu: ${err?.message || err}. Seguindo so com HTTPS.`));
    server.listen(port, "127.0.0.1", () => logger.info("Server", `HTTP interno em 127.0.0.1:${port} (nao exposto na rede)`));
  } else {
    // Sem certificado (ex.: dev): cai para HTTP puro — aí a porta HTTP e a principal.
    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        logger.error("Server", `A porta ${port} ja esta em uso: o ZapHub ja esta rodando. Saindo.`);
        process.exit(2);
      }
      logger.error("Server", "Erro no servidor HTTP", err);
    });
    server.listen(port, () => {
      logger.banner(pkg.name.toUpperCase(), pkg.version, port);
      aoSubir();
    });
  }
});
