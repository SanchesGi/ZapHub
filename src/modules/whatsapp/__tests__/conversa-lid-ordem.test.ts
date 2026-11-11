// minha versao: numero novo (@lid) e ordem das mensagens ao vivo (precisam de um banco MySQL/MariaDB de TESTE).
//   TEST_DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_teste" npm run test:banco
// Trava: so roda se o NOME do banco tiver "test". Cada teste cria a PROPRIA sessao e apaga so o que criou.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

const urlTeste = process.env.TEST_DATABASE_URL || "";
const nomeBanco = (() => { try { return new URL(urlTeste).pathname.replace(/^\//, ""); } catch { return ""; } })();
if (!/test/i.test(nomeBanco)) {
    throw new Error(`TEST_DATABASE_URL ausente ou o banco "${nomeBanco}" nao parece de teste (o nome precisa ter "test"). Nada foi feito.`);
}
process.env.DATABASE_URL = urlTeste; // antes de carregar o prisma

let prisma: typeof import("@/lib/prisma").prisma;
let ChatService: typeof import("@/modules/whatsapp/chat.service").ChatService;
let store: typeof import("@/modules/whatsapp/store/index");

const criadas: { userId: string; dbId: string }[] = [];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(cond: () => Promise<boolean>, ms = 8000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (await cond()) return true; await espera(100); }
    return false;
}

before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ ChatService } = await import("@/modules/whatsapp/chat.service"));
    store = await import("@/modules/whatsapp/store/index");
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
    return { dbId: s.id, chave: s.sessionId };
}

const TEL = "5546988887777@s.whatsapp.net";
const LID = "112233445566@lid";

function socketFalso(mapa: Record<string, string> = {}) {
    const ev = new EventEmitter();
    const sock: any = {
        ev,
        user: { id: "5546000000000:12@s.whatsapp.net", lid: "99887766:12@lid" },
        signalRepository: { lidMapping: { getPNForLID: async (lid: string) => mapa[lid] || null } },
    };
    const io: any = { to: () => ({ emit: () => {} }) };
    return { ev, sock, io };
}

let n = 0;
function msgTexto(remoteJid: string, fromMe: boolean, segundos: number, texto: string) {
    return {
        key: { remoteJid, id: `T${Date.now()}${++n}`, fromMe },
        message: { conversation: texto },
        messageTimestamp: segundos,
        pushName: fromMe ? undefined : "Cliente",
    };
}

test("vincularLidAoTelefone junta a conversa do @lid na do telefone", async () => {
    const { dbId } = await novaSessao();
    await prisma.message.create({ data: { sessionId: dbId, remoteJid: LID, fromMe: true, keyId: `L${++n}`, content: "oi", status: "SENT" } });
    await store.vincularLidAoTelefone(dbId, "112233445566:3@lid", TEL);

    const doTel = await ChatService.getMessages(dbId, TEL, 50);
    assert.equal(doTel.messages.length, 1, "a mensagem tem que aparecer na conversa do telefone");
    assert.equal(await prisma.message.count({ where: { sessionId: dbId, remoteJid: LID } }), 0);
    const c = await prisma.contact.findUnique({ where: { sessionId_jid: { sessionId: dbId, jid: TEL } } });
    assert.equal(c?.lid, LID);
});

test("vincularLidAoTelefone sem conversa no @lid nao cria contato", async () => {
    const { dbId } = await novaSessao();
    await store.vincularLidAoTelefone(dbId, LID, TEL);
    assert.equal(await prisma.contact.count({ where: { sessionId: dbId } }), 0);
});

test("minha mensagem para numero novo chega em @lid e fica na conversa do telefone", async () => {
    const { dbId, chave } = await novaSessao();
    const f = socketFalso({ [LID]: "5546988887777:0@s.whatsapp.net" });
    store.bindSessionStore(f.sock, chave, f.io);
    const m = msgTexto(LID, true, Math.floor(Date.now() / 1000), "primeira mensagem");
    f.ev.emit("messages.upsert", { messages: [m], type: "append" });
    assert.ok(await ate(async () => (await prisma.message.count({ where: { sessionId: dbId, keyId: m.key.id } })) === 1), "a mensagem nao foi gravada");
    const gravada = await prisma.message.findFirst({ where: { sessionId: dbId, keyId: m.key.id } });
    assert.equal(gravada?.remoteJid, TEL);
});

test("ao vivo: resposta rapida fica DEPOIS da minha, mesmo com a VM adiantada", async () => {
    const { dbId, chave } = await novaSessao();
    const f = socketFalso();
    store.bindSessionStore(f.sock, chave, f.io);
    const agoraS = Math.floor(Date.now() / 1000);
    // minha mensagem: horario do relogio da VM, 60 s adiantado
    const minha = msgTexto(TEL, true, agoraS + 60, "pergunta");
    f.ev.emit("messages.upsert", { messages: [minha], type: "append" });
    assert.ok(await ate(async () => (await prisma.message.count({ where: { sessionId: dbId, keyId: minha.key.id } })) === 1));
    await espera(20);
    // a resposta chega depois, com o horario (certo) do WhatsApp
    const resposta = msgTexto(TEL, false, agoraS, "resposta");
    f.ev.emit("messages.upsert", { messages: [resposta], type: "notify" });
    assert.ok(await ate(async () => (await prisma.message.count({ where: { sessionId: dbId, keyId: resposta.key.id } })) === 1));

    const { messages } = await ChatService.getMessages(dbId, TEL, 50);
    const ordem = messages.map((m: any) => m.content);
    assert.deepEqual(ordem, ["pergunta", "resposta"]);
});

test("historico mantem o horario do WhatsApp", async () => {
    const { dbId, chave } = await novaSessao();
    const f = socketFalso();
    store.bindSessionStore(f.sock, chave, f.io);
    const antigo = Math.floor(Date.now() / 1000) - 86_400;
    const m = msgTexto(TEL, false, antigo, "de ontem");
    f.ev.emit("messages.upsert", { messages: [m], type: "notify" });
    assert.ok(await ate(async () => (await prisma.message.count({ where: { sessionId: dbId, keyId: m.key.id } })) === 1));
    const g = await prisma.message.findFirst({ where: { sessionId: dbId, keyId: m.key.id } });
    assert.equal(Math.floor(g!.timestamp.getTime() / 1000), antigo);
});

test("mensagem encaminhada fica marcada (e quantas vezes)", async () => {
    const { dbId, chave } = await novaSessao();
    const f = socketFalso();
    store.bindSessionStore(f.sock, chave, f.io);
    const m: any = {
        key: { remoteJid: TEL, id: `T${Date.now()}${++n}`, fromMe: false },
        message: { extendedTextMessage: { text: "repassando", contextInfo: { isForwarded: true, forwardingScore: 5 } } },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: "Cliente",
    };
    f.ev.emit("messages.upsert", { messages: [m], type: "notify" });
    assert.ok(await ate(async () => (await prisma.message.count({ where: { sessionId: dbId, keyId: m.key.id } })) === 1));
    const g = await prisma.message.findFirst({ where: { sessionId: dbId, keyId: m.key.id } });
    assert.equal((g?.extra as any)?.encaminhada?.vezes, 5);
});
