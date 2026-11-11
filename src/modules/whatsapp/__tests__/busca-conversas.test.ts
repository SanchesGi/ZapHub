// minha versao: busca da lista de conversas (precisa de um banco MySQL/MariaDB de TESTE).
//   TEST_DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_teste" npm run test:banco
// Trava: so roda se o NOME do banco tiver "test". Cada teste cria a PROPRIA sessao e apaga so o que criou.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const urlTeste = process.env.TEST_DATABASE_URL || "";
const nomeBanco = (() => { try { return new URL(urlTeste).pathname.replace(/^\//, ""); } catch { return ""; } })();
if (!/test/i.test(nomeBanco)) {
    throw new Error(`TEST_DATABASE_URL ausente ou o banco "${nomeBanco}" nao parece de teste (o nome precisa ter "test"). Nada foi feito.`);
}
process.env.DATABASE_URL = urlTeste; // antes de carregar o prisma

let prisma: typeof import("@/lib/prisma").prisma;
let ChatService: typeof import("@/modules/whatsapp/chat.service").ChatService;
const criadas: { userId: string; dbId: string }[] = [];

before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ ChatService } = await import("@/modules/whatsapp/chat.service"));
});

after(async () => {
    for (const c of criadas) {
        await prisma.message.deleteMany({ where: { sessionId: c.dbId } });
        await prisma.contact.deleteMany({ where: { sessionId: c.dbId } });
        await prisma.session.deleteMany({ where: { id: c.dbId } });
        await prisma.user.deleteMany({ where: { id: c.userId } });
    }
    await prisma.$disconnect();
});

async function novaSessao() {
    const tag = randomUUID().slice(0, 8);
    const u = await prisma.user.create({ data: { email: `teste-${tag}@local`, password: "x", name: "Teste" } as any });
    const s = await prisma.session.create({ data: { userId: u.id, name: "Sessao teste", sessionId: `teste-${tag}` } });
    criadas.push({ userId: u.id, dbId: s.id });
    return s.id;
}

let n = 0;
async function msg(dbId: string, jid: string, diasAtras: number, content: string) {
    await prisma.message.create({
        data: { sessionId: dbId, remoteJid: jid, fromMe: false, keyId: `B${Date.now()}${++n}`, content, status: "READ", timestamp: new Date(Date.now() - diasAtras * 86_400_000) },
    });
}

test("variantesNumero cobre formatacao, 55 e o nono digito", () => {
    const v = ChatService.variantesNumero("(46) 99999-8888");
    assert.ok(v.includes("46999998888"));
    assert.ok(v.includes("4699998888"), "sem o 9");
    assert.deepEqual(ChatService.variantesNumero("ab"), []);
});

test("busca acha conversa antiga (fora das 50 recentes) por numero e por nome, e mensagem pelo texto", async () => {
    const dbId = await novaSessao();
    const ANTIGO = "554699998888@s.whatsapp.net"; // conta antiga, sem o 9
    await msg(dbId, ANTIGO, 400, "orçamento do telhado");
    await prisma.contact.create({ data: { sessionId: dbId, jid: ANTIGO, name: "José Telhados" } });
    for (let i = 0; i < 60; i++) await msg(dbId, `55469000${String(i).padStart(5, "0")}@s.whatsapp.net`, i / 10, `oi ${i}`);

    const porNumero = (await ChatService.getChatsList(dbId, 50, undefined, "46 99999-8888", "all")) as any[];
    assert.ok(porNumero.some((c) => c.jid === ANTIGO), "numero formatado, com o 9 a mais");

    const porNome = (await ChatService.getChatsList(dbId, 50, undefined, "jose", "all")) as any[];
    assert.ok(porNome.some((c) => c.jid === ANTIGO), "nome sem acento e minusculo");

    const geral = await ChatService.buscarGeral(dbId, "telhado");
    assert.ok(geral.mensagens.some((m) => m.remoteJid === ANTIGO));
    assert.equal(geral.mensagens.find((m) => m.remoteJid === ANTIGO)?.nomeConversa, "José Telhados");
});
