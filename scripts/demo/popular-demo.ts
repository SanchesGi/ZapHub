// minha versao: preenche o banco da DEMONSTRACAO com dados ficticios (Cafe Aurora, uma cafeteria inventada).
// Uso (num banco DESCARTAVEL, com "demo" no nome):
//   DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_demo" npx prisma db push
//   DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_demo" npx tsx scripts/demo/popular-demo.ts
// APAGA TUDO o que houver nesse banco antes de preencher (por isso exige "demo" no nome).
// Pessoas, numeros (DDD 00, que nao existe), empresas e enderecos sao inventados.
// Acesso: demo@zaphub.demo / demo1234 (Super Administrador). Rode o sistema com ZAPHUB_DEMO=true.
import { PrismaClient, MessageType, MessageStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import { VERSAO_TERMOS } from "../../src/lib/termos";

const url = process.env.DATABASE_URL || "";
const banco = (/\/([^/?]+)(\?|$)/.exec(url) || [])[1] || "";
if (!/demo/i.test(banco)) {
    console.error("Recusado: o nome do banco no DATABASE_URL nao tem \"demo\". Este script APAGA o banco inteiro.");
    process.exit(1);
}

const prisma = new PrismaClient();
const PASTA_MIDIA = path.resolve(process.env.DEMO_PASTA_MIDIA || path.join(process.cwd(), "data", "demo-midia"));
const AGORA = Date.now();
const min = (m: number) => new Date(AGORA - m * 60_000);
const dia = (d: number, h: number, m = 0) => { const x = new Date(AGORA); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x; };
const pn = (n: string) => `55009${n}@s.whatsapp.net`; // DDD 00: nao existe

let contador = 0;
const novoId = () => `DEMO${(++contador).toString(16).toUpperCase().padStart(12, "0")}`;

// ---------- imagens e documento gerados aqui (sem arquivos externos) ----------
function cartao(titulo: string, linhas: string[], rodape: string): string {
    const itens = linhas.map((l, i) => `<text x="80" y="${330 + i * 64}" font-size="34" fill="#3B2A1A" font-family="Georgia, serif">• ${l}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4E0"/><stop offset="1" stop-color="#F6D9A8"/></linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <rect x="40" y="40" width="1000" height="1000" rx="36" fill="none" stroke="#C47A1E" stroke-width="6"/>
  <text x="80" y="150" font-size="40" fill="#C47A1E" font-family="Arial, sans-serif" font-weight="700" letter-spacing="6">CAFÉ AURORA</text>
  <text x="80" y="235" font-size="64" fill="#3B2A1A" font-family="Georgia, serif" font-weight="700">${titulo}</text>
  ${itens}
  <text x="80" y="980" font-size="30" fill="#7A5A3A" font-family="Arial, sans-serif">${rodape}</text>
</svg>`;
}

function pdfSimples(linhas: string[]): Buffer {
    const conteudo = "BT /F1 16 Tf 60 760 Td 22 TL " + linhas.map((l) => `(${l.replace(/[()\\]/g, "")}) '`).join(" ") + " ET";
    const objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let out = "%PDF-1.4\n";
    const pos: number[] = [];
    objs.forEach((o, i) => { pos.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
}

async function gravarMidia(sessao: string, keyId: string, ext: string, dados: Buffer): Promise<string> {
    const nome = `${sessao}-${keyId}.${ext}`;
    await fs.writeFile(path.join(PASTA_MIDIA, nome), dados);
    return `/api/media/${nome}`;
}

// ---------- dados ----------
type M = { de: "eu" | "ele"; t: string; quando: Date; por?: string; tipo?: MessageType; arquivo?: { ext: string; dados: Buffer }; quem?: string };

async function main() {
    console.log("Preenchendo o banco da demonstracao...");

    // limpa tudo (ordem por dependencia; Session apaga em cascata o que e dela)
    await prisma.chatLabel.deleteMany(); await prisma.label.deleteMany();
    await prisma.logAcesso.deleteMany(); // registros de acesso nao sobrevivem a restauracao
    await prisma.broadcastRecipient.deleteMany(); await prisma.broadcastLog.deleteMany();
    await prisma.chatLeitura.deleteMany(); await prisma.chatEstado.deleteMany();
    await prisma.message.deleteMany(); await prisma.contact.deleteMany();
    await prisma.session.deleteMany(); await prisma.notification.deleteMany();
    await prisma.aceiteTermos.deleteMany(); await prisma.user.deleteMany();
    await fs.rm(PASTA_MIDIA, { recursive: true, force: true });
    await fs.mkdir(PASTA_MIDIA, { recursive: true });
    await fs.writeFile(path.join(PASTA_MIDIA, ".zaphub-midia"), "pasta de midia do ZapHub (demonstracao)\n");

    await prisma.systemConfig.upsert({
        where: { id: "default" },
        update: { appName: "ZapHub", pastaMidia: PASTA_MIDIA, enableRegistration: false, retencaoMensagensDias: 365, retencaoMidiasDias: 180, retencaoLogsDias: 90 },
        create: { id: "default", appName: "ZapHub", pastaMidia: PASTA_MIDIA, enableRegistration: false, retencaoMensagensDias: 365, retencaoMidiasDias: 180, retencaoLogsDias: 90 },
    });

    const senha = await bcrypt.hash("demo1234", 10);
    const senhaEquipe = await bcrypt.hash(`equipe-${AGORA}`, 10); // contas da equipe nao sao usadas para entrar
    const ana = await prisma.user.create({ data: { name: "Ana Souza", email: "demo@zaphub.demo", password: senha, role: "SUPERADMIN", termosVersao: VERSAO_TERMOS } });
    const bruno = await prisma.user.create({ data: { name: "Bruno Lima", email: "bruno@cafeaurora.demo", password: senhaEquipe, role: "STAFF", supervisorId: ana.id, termosVersao: VERSAO_TERMOS } });
    const carla = await prisma.user.create({ data: { name: "Carla Dias", email: "carla@cafeaurora.demo", password: senhaEquipe, role: "USER", supervisorId: ana.id, termosVersao: VERSAO_TERMOS } });
    for (const u of [ana, bruno, carla]) await prisma.aceiteTermos.create({ data: { userId: u.id, versao: VERSAO_TERMOS, aceitoEm: dia(7, 9), ip: "127.0.0.1" } });

    // ordem de criacao: a mais recente aparece primeiro no painel (o Atendimento fica em destaque)
    await prisma.session.create({ data: { userId: ana.id, name: "Filial Centro", sessionId: "demo-filial", status: "STOPPED", createdAt: dia(30, 9) } });
    const vendas = await prisma.session.create({ data: { userId: ana.id, name: "Vendas e encomendas", sessionId: "demo-vendas", status: "CONNECTED", createdAt: dia(20, 9) } });
    const atend = await prisma.session.create({ data: { userId: ana.id, name: "Atendimento", sessionId: "demo-atendimento", status: "CONNECTED", createdAt: dia(10, 9) } });
    for (const s of [atend, vendas]) {
        await prisma.sessionAccess.create({ data: { sessionId: s.id, userId: bruno.id } });
        await prisma.sessionAccess.create({ data: { sessionId: s.id, userId: carla.id } });
    }
    await prisma.botConfig.create({ data: { sessionId: atend.id, botName: "Aurora", welcomeMessage: "Olá! Bem-vindo ao Café Aurora ☕ Em que podemos ajudar?", autoRead: false } });

    async function conversa(sess: { id: string; sessionId: string }, jid: string, nome: string, msgs: M[], lidaAte?: Date) {
        await prisma.contact.upsert({
            where: { sessionId_jid: { sessionId: sess.id, jid } },
            update: {},
            create: { sessionId: sess.id, jid, name: jid.endsWith("@g.us") ? null : nome, notify: nome },
        });
        for (const m of msgs) {
            const keyId = novoId();
            const tipo = m.tipo || "TEXT";
            const mediaUrl = m.arquivo ? await gravarMidia(sess.sessionId, keyId, m.arquivo.ext, m.arquivo.dados) : null;
            const eu = m.de === "eu";
            await prisma.message.create({
                data: {
                    sessionId: sess.id, remoteJid: jid, keyId, fromMe: eu, type: tipo, content: m.t, mediaUrl,
                    senderJid: eu ? null : (m.quem ? pn(m.quem) : jid), pushName: eu ? null : (m.quem ? m.quem : nome),
                    status: eu ? MessageStatus.READ : MessageStatus.DELIVERED, timestamp: m.quando,
                    sentBy: eu ? (m.por || "Ana Souza") : null, origemEnvio: eu ? "PLATAFORMA" : null,
                },
            });
        }
        await prisma.chatLeitura.create({ data: { sessionId: sess.id, jid, lidoEm: lidaAte || new Date(AGORA) } });
    }

    const cardapio = await sharp(Buffer.from(cartao("Recheios da semana", ["Chocolate com morango", "Doce de leite com nozes", "Ninho com frutas vermelhas", "Limão siciliano", "Prestígio", "Red velvet"], "Encomendas com 48 h de antecedência · (00) 90000-0000"))).jpeg({ quality: 88 }).toBuffer();
    const fornada = await sharp(Buffer.from(cartao("Fornada das 15h", ["Pão de fermentação natural", "Ciabatta de azeitonas", "Brioche de canela", "Focaccia de alecrim"], "Saindo agora do forno · Rua Exemplo, 123"))).jpeg({ quality: 88 }).toBuffer();
    const promo = await sharp(Buffer.from(cartao("Sexta do café", ["2 cafés coados", "1 croissant de manteiga", "por R$ 19,90"], "Válido nesta sexta, das 7h às 11h"))).jpeg({ quality: 88 }).toBuffer();
    const nota = pdfSimples(["Cafe Aurora - documento de exemplo", "Nota fiscal (ficticia) - pedido 1279", "Bolo de cenoura com chocolate ......... R$ 68,00", "Pao de fermentacao natural x2 .......... R$ 36,00", "Total ................................... R$ 104,00", "", "Documento gerado para a demonstracao do ZapHub."]);

    // ---- Atendimento ----
    const mariana = pn("0000101"), pedro = pn("0000102"), juliana = pn("0000103"), rafael = pn("0000104"), fernanda = pn("0000105"),
        lucas = pn("0000106"), beatriz = pn("0000107"), thiago = pn("0000108"), camila = pn("0000109"), gustavo = pn("0000110");
    const grupo = "120363000000000001@g.us";

    await conversa(atend, mariana, "Mariana Alves", [
        { de: "ele", t: "Bom dia! Vocês fazem bolo de aniversário para sábado?", quando: min(95) },
        { de: "eu", t: "Bom dia, Mariana! Fazemos sim 😊 Para quantas pessoas seria?", quando: min(93) },
        { de: "ele", t: "Umas 20 pessoas. Pode ser de chocolate com morango?", quando: min(90) },
        { de: "eu", t: "Pode! O de 20 fatias sai por R$ 145,00. Vou te mandar os recheios da semana.", quando: min(88) },
        { de: "eu", t: "Recheios da semana", tipo: "IMAGE", arquivo: { ext: "jpg", dados: cardapio }, quando: min(87) },
        { de: "ele", t: "Perfeito! Vou querer o de chocolate com morango, com a escrita \"Parabéns, Lia!\"", quando: min(80) },
        { de: "eu", t: "Anotado ✅ Retirada no sábado às 10h. Te mando o link do sinal em seguida.", quando: min(78) },
        { de: "ele", t: "Combinado, obrigada! 🙏", quando: min(12) },
    ], min(60));
    await conversa(atend, pedro, "Pedro Henrique", [
        { de: "ele", t: "Oi, meu pedido #1284 já saiu para entrega?", quando: min(48) },
        { de: "eu", t: "Oi, Pedro! Saiu às 11h40, o entregador chega em uns 15 minutos 🛵", quando: min(46), por: "Bruno Lima" },
        { de: "ele", t: "Ótimo, obrigado!", quando: min(45) },
    ]);
    await conversa(atend, juliana, "Juliana Costa", [
        { de: "ele", t: "Boa tarde! Consegue me enviar a nota fiscal da compra de ontem?", quando: min(130) },
        { de: "eu", t: "Nota fiscal - pedido 1279.pdf", tipo: "DOCUMENT", arquivo: { ext: "pdf", dados: nota }, quando: min(126), por: "Carla Dias" },
        { de: "eu", t: "Prontinho, Juliana! Qualquer coisa é só chamar.", quando: min(126), por: "Carla Dias" },
        { de: "ele", t: "Recebi, valeu!", quando: min(120) },
    ]);
    await conversa(atend, rafael, "Rafael Martins", [
        { de: "ele", t: "Olá! Queria um orçamento de coffee break para 40 pessoas na próxima quinta.", quando: min(9) },
        { de: "ele", t: "Seria às 15h, aqui no escritório (Av. Exemplo, 100).", quando: min(8) },
    ], min(600));
    await conversa(atend, fernanda, "Fernanda Rocha", [
        { de: "ele", t: "Vocês abrem no feriado?", quando: min(240) },
        { de: "eu", t: "Abrimos sim, das 8h às 14h 😉", quando: min(238), por: "Bruno Lima" },
    ]);
    await conversa(atend, lucas, "Lucas Pereira", [
        { de: "ele", t: "Tem pão de fermentação natural hoje?", quando: min(30) },
        { de: "eu", t: "Tem sim! Acabou de sair do forno:", quando: min(28) },
        { de: "eu", t: "Fornada das 15h", tipo: "IMAGE", arquivo: { ext: "jpg", dados: fornada }, quando: min(28) },
        { de: "ele", t: "Separa dois pra mim? Passo aí às 17h", quando: min(25) },
        { de: "eu", t: "Separados no seu nome 👍", quando: min(24) },
    ]);
    await conversa(atend, grupo, "Equipe Café Aurora", [
        { de: "eu", t: "Pessoal, hoje temos 3 encomendas para retirar até as 18h.", quando: min(180) },
        { de: "ele", quem: "Bruno Lima", t: "Já separei as caixas e as etiquetas 👍", quando: min(175) },
        { de: "ele", quem: "Carla Dias", t: "Fico com o orçamento do coffee break de quinta.", quando: min(7) },
    ]);
    await prisma.group.create({ data: { sessionId: atend.id, jid: grupo, subject: "Equipe Café Aurora", description: "Avisos do dia a dia da loja", participants: [{ id: pn("0000900"), admin: "superadmin" }, { id: pn("0000901"), admin: null }, { id: pn("0000902"), admin: null }] } });
    await conversa(atend, beatriz, "Beatriz Gomes", [
        { de: "ele", t: "Vocês aceitam vale-refeição?", quando: dia(1, 16, 20) },
        { de: "eu", t: "Aceitamos sim, Beatriz! Todas as bandeiras principais.", quando: dia(1, 16, 22) },
    ]);
    await conversa(atend, thiago, "Thiago Ribeiro", [
        { de: "ele", t: "Chegou tudo certinho, muito obrigado!", quando: dia(1, 11, 5) },
        { de: "eu", t: "Que bom, Thiago! Bom apetite ☕", quando: dia(1, 11, 7) },
    ]);
    await conversa(atend, camila, "Camila Fernandes", [
        { de: "ele", t: "Qual o valor da torta de limão inteira?", quando: dia(2, 15, 40) },
        { de: "eu", t: "A inteira (16 fatias) sai por R$ 98,00.", quando: dia(2, 15, 43) },
    ]);
    await conversa(atend, gustavo, "Gustavo Araújo", [
        { de: "ele", t: "Bom dia, vocês entregam no bairro Jardim Exemplo?", quando: dia(3, 9, 10) },
        { de: "eu", t: "Entregamos! A taxa para o seu bairro é R$ 6,00.", quando: dia(3, 9, 12) },
    ]);
    await prisma.chatEstado.create({ data: { sessionId: atend.id, jid: grupo, fixadaEm: dia(5, 8) } });
    await prisma.chatEstado.create({ data: { sessionId: atend.id, jid: gustavo, arquivada: true } });

    const etiquetas = await Promise.all([
        prisma.label.create({ data: { sessionId: atend.sessionId, name: "Encomenda", color: 3, colorHex: "#F4A935" } }),
        prisma.label.create({ data: { sessionId: atend.sessionId, name: "Entrega", color: 7, colorHex: "#3B82F6" } }),
        prisma.label.create({ data: { sessionId: atend.sessionId, name: "Orçamento", color: 11, colorHex: "#8B5CF6" } }),
        prisma.label.create({ data: { sessionId: atend.sessionId, name: "Cliente VIP", color: 1, colorHex: "#10B981" } }),
    ]);
    const [encomenda, entrega, orcamento, vip] = etiquetas;
    for (const [l, j] of [[encomenda, mariana], [vip, mariana], [entrega, pedro], [orcamento, rafael], [encomenda, lucas]] as const) {
        await prisma.chatLabel.create({ data: { labelId: l.id, chatJid: j } });
    }

    // ---- Vendas e encomendas ----
    const empresa = pn("0000201"), festa = pn("0000202");
    await conversa(vendas, empresa, "Escritório Exemplo Ltda", [
        { de: "ele", t: "Bom dia! Podemos fechar 30 kits de café da manhã para segunda?", quando: min(70) },
        { de: "eu", t: "Bom dia! Podemos sim. Cada kit sai por R$ 32,00, com entrega às 8h.", quando: min(66), por: "Carla Dias" },
        { de: "ele", t: "Fechado. Pode emitir a nota no CNPJ do cadastro.", quando: min(60) },
    ]);
    await conversa(vendas, festa, "Buffet Festa Boa", [
        { de: "ele", t: "Vocês fornecem 200 mini croissants para sábado?", quando: dia(1, 14, 0) },
        { de: "eu", t: "Fornecemos! Te mando o orçamento ainda hoje.", quando: dia(1, 14, 5), por: "Carla Dias" },
    ]);

    // ---- automacoes ----
    await prisma.autoReply.createMany({
        data: [
            { sessionId: atend.id, keyword: "horário", matchType: "CONTAINS", response: "Funcionamos de segunda a sábado, das 7h às 19h, e aos domingos das 8h às 13h. ☕", triggerType: "PRIVATE" },
            { sessionId: atend.id, keyword: "cardápio", matchType: "CONTAINS", response: "Nosso cardápio completo está em cafeaurora.exemplo/cardapio 😉", triggerType: "PRIVATE" },
            { sessionId: atend.id, keyword: "pix", matchType: "EXACT", response: "Nossa chave PIX (exemplo): pix@cafeaurora.demo", triggerType: "ALL" },
        ],
    });
    await prisma.scheduledMessage.createMany({
        data: [
            { sessionId: atend.id, jid: mariana, content: "Oi, Mariana! Seu bolo fica pronto amanhã às 10h. Até lá! 🎂", sendAt: dia(-1, 9) },
            { sessionId: atend.id, jid: grupo, content: "Bom dia, equipe! Lembrete: conferir o estoque de leite e café antes das 7h.", sendAt: dia(-1, 6, 30), cronExpression: "30 6 * * 1-6" },
            { sessionId: vendas.id, jid: empresa, content: "Os 30 kits saem para entrega às 7h30. Obrigado pela preferência!", sendAt: dia(-3, 7, 30) },
        ],
    });
    const camp1 = await prisma.broadcastLog.create({
        data: { sessionId: atend.sessionId, message: "Sexta do café ☕ 2 cafés coados + 1 croissant por R$ 19,90, das 7h às 11h. Te esperamos!", total: 120, sent: 118, failed: 2, status: "completed", delay: 3000, startedAt: dia(1, 8), completedAt: dia(1, 8, 9) },
    });
    const contatosCampanha = [mariana, pedro, juliana, fernanda, lucas, beatriz, thiago, camila];
    for (const [i, j] of contatosCampanha.entries()) {
        await prisma.broadcastRecipient.create({ data: { broadcastLogId: camp1.id, jid: j, status: i === 5 ? "failed" : "sent", error: i === 5 ? "Número sem WhatsApp" : null, sentAt: dia(1, 8, i) } });
    }
    await prisma.broadcastLog.create({
        data: { sessionId: atend.sessionId, message: "Novidade da semana: bolo de fubá com goiabada 🍰 Peça já o seu!", total: 85, sent: 85, failed: 0, status: "completed", delay: 3000, startedAt: dia(4, 10), completedAt: dia(4, 10, 6) },
    });
    await prisma.webhook.create({
        data: { userId: ana.id, sessionId: atend.id, name: "Sistema de pedidos (exemplo)", url: "https://pedidos.cafeaurora.demo/zaphub/webhook", events: ["message.received", "message.sent"], isActive: true },
    });

    const total = await prisma.message.count();
    console.log(`Pronto: ${total} mensagens, 3 usuarios, 3 sessoes. Entre com demo@zaphub.demo / demo1234.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
