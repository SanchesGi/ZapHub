// minha versao: LGPD — direitos do titular e retencao (precisa de um banco MySQL/MariaDB de TESTE).
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
let titular: typeof import("@/lib/titular");
let retencao: typeof import("@/lib/retencao");
const criadas: { userId: string; dbId: string }[] = [];

before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    titular = await import("@/lib/titular");
    retencao = await import("@/lib/retencao");
});

after(async () => {
    for (const c of criadas) {
        await prisma.message.deleteMany({ where: { sessionId: c.dbId } });
        await prisma.contact.deleteMany({ where: { sessionId: c.dbId } });
        await prisma.group.deleteMany({ where: { sessionId: c.dbId } });
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
    return { dbId: s.id, sessionId: s.sessionId };
}

let n = 0;
async function msg(dbId: string, jid: string, diasAtras: number, content: string, extra: Record<string, unknown> = {}) {
    await prisma.message.create({
        data: { sessionId: dbId, remoteJid: jid, fromMe: false, keyId: `L${Date.now()}${++n}`, content, status: "READ", timestamp: new Date(Date.now() - diasAtras * 86_400_000), ...extra },
    });
}

test("titular: acha por telefone sem 55/9 e pelo lid do contato, e apaga so o dele", async () => {
    const { dbId } = await novaSessao();
    const numero = String(5546900000000 + Math.floor(Math.random() * 99999999)).slice(0, 13); // 13 digitos, 9o digito presente
    const jid = `${numero}@s.whatsapp.net`;
    const lid = `${randomUUID().replace(/\D/g, "").slice(0, 14)}@lid`;
    const outro = "5511988887777@s.whatsapp.net";
    await prisma.contact.create({ data: { sessionId: dbId, jid: lid, lid, remoteJidAlt: jid, name: "Titular" } });
    await msg(dbId, lid, 1, "oi do titular");        // conversa guardada pelo lid
    await msg(dbId, jid, 2, "oi pelo telefone");
    await msg(dbId, outro, 1, "mensagem de outra pessoa");

    const local = numero.slice(2);
    const resumo = await titular.resumoDoTitular(local);
    assert.ok(resumo);
    assert.equal(resumo!.contatos, 1);
    assert.equal(resumo!.mensagens, 2);

    const r = await titular.apagarTitular(local);
    assert.equal(r!.mensagens, 2);
    assert.equal(r!.contatos, 1);
    assert.equal(await prisma.message.count({ where: { sessionId: dbId } }), 1, "a mensagem da outra pessoa fica");
});

test("retencao: apaga so mensagens mais antigas que o prazo", async () => {
    const { dbId } = await novaSessao();
    const jid = "5511977776666@s.whatsapp.net";
    await msg(dbId, jid, 400, "antiga");
    await msg(dbId, jid, 5, "recente");
    const antes = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    try {
        await prisma.systemConfig.upsert({ where: { id: "default" }, update: { retencaoMensagensDias: 365, retencaoMidiasDias: null, retencaoLogsDias: null }, create: { id: "default", retencaoMensagensDias: 365 } });
        const r = await retencao.executarRetencao("MANUAL");
        assert.ok(!r.erro, r.erro);
        const restam = await prisma.message.findMany({ where: { sessionId: dbId }, select: { content: true } });
        assert.deepEqual(restam.map((m) => m.content), ["recente"]);
    } finally {
        if (antes) await prisma.systemConfig.update({ where: { id: "default" }, data: { retencaoMensagensDias: antes.retencaoMensagensDias, retencaoMidiasDias: antes.retencaoMidiasDias, retencaoLogsDias: antes.retencaoLogsDias } });
        else await prisma.systemConfig.delete({ where: { id: "default" } }).catch(() => {});
    }
});
