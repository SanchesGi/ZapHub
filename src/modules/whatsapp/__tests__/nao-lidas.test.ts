// minha versao: testes das NAO LIDAS (precisam de um banco MySQL/MariaDB de TESTE).
//   TEST_DATABASE_URL="mysql://usuario:senha@127.0.0.1:3306/zaphub_teste" npm run test:banco
// Trava: so roda se o NOME do banco tiver "test" (evita apagar dados da producao por engano).
// Cada teste cria a PROPRIA sessao e apaga so o que criou.
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
let lidaAte: typeof import("@/lib/leitura").lidaAte;
let contarNaoLidas: typeof import("@/lib/leitura").contarNaoLidas;
let ChatService: typeof import("@/modules/whatsapp/chat.service").ChatService;
let bindSessionStore: typeof import("@/modules/whatsapp/store/index").bindSessionStore;

const criadas: { userId: string; dbId: string }[] = [];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
// espera a condicao ficar verdadeira (os handlers do store sao assincronos)
async function ate(cond: () => Promise<boolean>, ms = 5000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (await cond()) return true; await espera(100); }
    return false;
}

before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ lidaAte, contarNaoLidas } = await import("@/lib/leitura"));
    ({ ChatService } = await import("@/modules/whatsapp/chat.service"));
    ({ bindSessionStore } = await import("@/modules/whatsapp/store/index"));
});

after(async () => {
    for (const c of criadas) {
        await prisma.chatLeitura.deleteMany({ where: { sessionId: c.dbId } });
        await prisma.message.deleteMany({ where: { sessionId: c.dbId } });
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

let n = 0;
async function recebida(dbId: string, jid: string, segundos: number, quem = jid) {
    const keyId = `T${Date.now()}${++n}`;
    await prisma.message.create({
        data: { sessionId: dbId, remoteJid: jid, senderJid: quem, fromMe: false, keyId, content: `msg ${n}`, timestamp: new Date(Date.now() + segundos * 1000), status: "DELIVERED" },
    });
    return keyId;
}
async function ler(dbId: string, jid: string, lidoEm: Date) {
    await prisma.chatLeitura.upsert({
        where: { sessionId_jid: { sessionId: dbId, jid } },
        update: { lidoEm, naoLida: false },
        create: { sessionId: dbId, jid, lidoEm },
    });
}
const naLista = async (dbId: string, jid: string) =>
    ((await ChatService.getChatsList(dbId, 50)) as any[]).find((c) => c.jid === jid)?.unread ?? -1;

const PRIV = "5546999990000@s.whatsapp.net";
const GRUPO = "120363000000000001@g.us";
const OUTRO = "5546911112222@s.whatsapp.net";

// ---------------- relogio da VM fora de hora ----------------
test("relogio da VM atrasado: conversa lida nao volta como nao lida", async () => {
    const { dbId } = await novaSessao();
    for (const s of [60, 120, 170]) await recebida(dbId, PRIV, s); // horario "a frente" da VM
    await ler(dbId, PRIV, await lidaAte(dbId, PRIV));
    assert.equal(await naLista(dbId, PRIV), 0);
    await recebida(dbId, PRIV, 200);
    assert.equal(await naLista(dbId, PRIV), 1, "mensagem nova depois da leitura tem que contar");
});

test("relogio da VM adiantado: mensagem nova depois da leitura conta", async () => {
    const { dbId } = await novaSessao();
    for (const s of [-300, -240]) await recebida(dbId, PRIV, s);
    await ler(dbId, PRIV, await lidaAte(dbId, PRIV));
    assert.equal(await naLista(dbId, PRIV), 0);
    await recebida(dbId, PRIV, -120);
    assert.equal(await naLista(dbId, PRIV), 1);
});

test("contarNaoLidas usa a mesma regra da lista", async () => {
    const { dbId } = await novaSessao();
    for (const s of [-30, -20, -10]) await recebida(dbId, PRIV, s);
    assert.equal(await contarNaoLidas(dbId, PRIV), await naLista(dbId, PRIV));
    assert.equal(await contarNaoLidas(dbId, PRIV), 3);
});

// ---------------- lida no celular / WhatsApp Web ----------------
function socketFalso() {
    const ev = new EventEmitter();
    const avisos: string[] = [];
    const sock: any = { ev, user: { id: "5546000000000:12@s.whatsapp.net", lid: "99887766:12@lid" } };
    const io: any = { to: () => ({ emit: (e: string, d: any) => { if (e === "chat.lida") avisos.push(d.jid); } }) };
    return { ev, sock, io, avisos };
}
async function ligarStore(chave: string, dbId: string) {
    const f = socketFalso();
    bindSessionStore(f.sock, chave, f.io);
    // o store descobre o id da sessao no banco de forma assincrona: espera ele aceitar um evento
    const sonda = await recebida(dbId, "sonda@s.whatsapp.net", -1000);
    const pronto = await ate(async () => {
        f.ev.emit("messages.update", [{ key: { remoteJid: "sonda@s.whatsapp.net", id: sonda, fromMe: false }, update: { status: 4 } }]);
        await espera(150);
        return (await prisma.message.findFirst({ where: { sessionId: dbId, keyId: sonda } }))?.status === "READ";
    }, 10000);
    assert.ok(pronto, "o store nao ficou pronto");
    f.avisos.length = 0;
    return f;
}

test("conversa privada lida no celular (aos poucos e toda)", async () => {
    const { dbId, chave } = await novaSessao();
    const f = await ligarStore(chave, dbId);
    const ids = [await recebida(dbId, PRIV, -300), await recebida(dbId, PRIV, -200), await recebida(dbId, PRIV, -100)];
    assert.equal(await naLista(dbId, PRIV), 3);

    f.ev.emit("messages.update", ids.slice(0, 2).map((id) => ({ key: { remoteJid: PRIV, id, fromMe: false }, update: { status: 4 } })));
    assert.ok(await ate(async () => (await naLista(dbId, PRIV)) === 1));
    await espera(300);
    assert.equal(f.avisos.filter((j) => j === PRIV).length, 0, "ainda tem nao lida: nao pode avisar 'lida'");

    f.ev.emit("messages.update", [{ key: { remoteJid: PRIV, id: ids[2], fromMe: false }, update: { status: 4 } }]);
    assert.ok(await ate(async () => (await naLista(dbId, PRIV)) === 0));
    assert.ok(await ate(async () => f.avisos.includes(PRIV)), "paineis tem que ser avisados");
});

test("grupo lido no celular (recibo do proprio numero, por jid e por LID)", async () => {
    const { dbId, chave } = await novaSessao();
    const f = await ligarStore(chave, dbId);
    const ids = [await recebida(dbId, GRUPO, -300, OUTRO), await recebida(dbId, GRUPO, -200, OUTRO)];
    const agora = Math.floor(Date.now() / 1000);

    f.ev.emit("message-receipt.update", [{ key: { remoteJid: GRUPO, id: ids[0], fromMe: false }, receipt: { userJid: "5546000000000@s.whatsapp.net", readTimestamp: agora } }]);
    assert.ok(await ate(async () => (await naLista(dbId, GRUPO)) === 1));

    f.ev.emit("message-receipt.update", [{ key: { remoteJid: GRUPO, id: ids[1], fromMe: false }, receipt: { userJid: "99887766@lid", readTimestamp: agora } }]);
    assert.ok(await ate(async () => (await naLista(dbId, GRUPO)) === 0));
    assert.ok(await ate(async () => f.avisos.includes(GRUPO)));
});

test("grupo: recibo de OUTRO participante nao marca como lida", async () => {
    const { dbId, chave } = await novaSessao();
    const f = await ligarStore(chave, dbId);
    const ids = [await recebida(dbId, GRUPO, -120, OUTRO), await recebida(dbId, GRUPO, -60, OUTRO)];
    f.ev.emit("message-receipt.update", ids.map((id) => ({ key: { remoteJid: GRUPO, id, fromMe: false, participant: OUTRO }, receipt: { userJid: OUTRO, readTimestamp: Math.floor(Date.now() / 1000) } })));
    await espera(1000);
    assert.equal(await naLista(dbId, GRUPO), 2);
    assert.equal(f.avisos.length, 0);
});
