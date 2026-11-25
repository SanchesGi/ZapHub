import test from "node:test";
import assert from "node:assert/strict";
import {
    STATUS_JID, VALIDADE_STATUS_MS, ehJidDeStatus, expiraEmDe, statusVigente, argbParaHex, lerConteudoDeStatus,
    tempoDeExibicaoMs, agruparStatus, nomeDoAutor, validarPublicacao, escolherDestinatarios, validarResposta,
    citacaoDoStatus, tempoRelativo, COR_FUNDO_PADRAO, TEXTO_STATUS_MAX, IMAGEM_STATUS_MAX_BYTES, VIDEO_STATUS_MAX_BYTES,
    DESTINATARIOS_STATUS_MAX, segundosParaPublicar, mensagemDeEsperaDoStatus, type ItemStatus,
} from "../status-puro";

const AGORA = new Date("2026-11-25T15:00:00Z").getTime();
const HORA = 60 * 60 * 1000;

test("status@broadcast e reconhecido e o resto nao", () => {
    assert.equal(ehJidDeStatus(STATUS_JID), true);
    assert.equal(ehJidDeStatus("5511999999999@s.whatsapp.net"), false);
    assert.equal(ehJidDeStatus("120363000000000000@broadcast"), false);
    assert.equal(ehJidDeStatus(null), false);
});

test("validade: vale por 24 h e vence na hora exata", () => {
    const criado = new Date(AGORA - 23 * HORA);
    assert.equal(expiraEmDe(criado).getTime(), criado.getTime() + VALIDADE_STATUS_MS);
    assert.equal(statusVigente({ criadoEm: criado }, AGORA), true);
    assert.equal(statusVigente({ criadoEm: AGORA - 24 * HORA }, AGORA), false); // venceu exatamente agora
    assert.equal(statusVigente({ criadoEm: AGORA - 25 * HORA }, AGORA), false);
    // com expiraEm gravado, ele manda (mesmo que a conta de 24 h dissesse o contrario)
    assert.equal(statusVigente({ criadoEm: AGORA - 30 * HORA, expiraEm: new Date(AGORA + HORA) }, AGORA), true);
    assert.equal(statusVigente({ criadoEm: AGORA, expiraEm: new Date(AGORA - 1) }, AGORA), false);
    assert.equal(statusVigente({ criadoEm: "lixo" }, AGORA), false);
});

test("argbParaHex converte a cor do WhatsApp e ignora o que nao e cor", () => {
    assert.equal(argbParaHex(0xffa8650a), "#A8650A");
    assert.equal(argbParaHex(-5741302), "#A8650A"); // mesmo valor como inteiro com sinal
    assert.equal(argbParaHex("4289225994"), "#A8650A");
    assert.equal(argbParaHex({ toNumber: () => 0xff00ff00 }), "#00FF00");
    assert.equal(argbParaHex(0), null);
    assert.equal(argbParaHex(null), null);
    assert.equal(argbParaHex(undefined), null);
    assert.equal(argbParaHex("abc"), null);
});

test("lerConteudoDeStatus: texto, foto e video; o resto e ignorado", () => {
    assert.deepEqual(lerConteudoDeStatus({ extendedTextMessage: { text: "Bom dia", backgroundArgb: 0xff1f4e5f, font: 2 } }),
        { tipo: "TEXT", texto: "Bom dia", fundo: "#1F4E5F", fonte: 2 });
    assert.deepEqual(lerConteudoDeStatus({ conversation: "oi" }), { tipo: "TEXT", texto: "oi", fundo: null, fonte: null });
    assert.deepEqual(lerConteudoDeStatus({ imageMessage: { caption: "praia" } }), { tipo: "IMAGE", texto: "praia", fundo: null, fonte: null });
    assert.deepEqual(lerConteudoDeStatus({ videoMessage: {} }), { tipo: "VIDEO", texto: "", fundo: null, fonte: null });
    assert.equal(lerConteudoDeStatus({ audioMessage: {} }), null);
    assert.equal(lerConteudoDeStatus({ extendedTextMessage: { text: "   " } }), null);
    assert.equal(lerConteudoDeStatus({ senderKeyDistributionMessage: {} }), null);
    assert.equal(lerConteudoDeStatus(null), null);
});

test("tempoDeExibicaoMs: texto cresce com o tamanho, video segue a duracao, tudo com limites", () => {
    assert.equal(tempoDeExibicaoMs("IMAGE", null), 6000);
    assert.equal(tempoDeExibicaoMs("TEXT", "oi"), 5000);
    assert.equal(tempoDeExibicaoMs("TEXT", "x".repeat(500)), 15000);
    assert.ok(tempoDeExibicaoMs("TEXT", "x".repeat(40)) > 5000);
    assert.equal(tempoDeExibicaoMs("VIDEO", null, 9000), 9000);
    assert.equal(tempoDeExibicaoMs("VIDEO", null, 500), 3000);
    assert.equal(tempoDeExibicaoMs("VIDEO", null, 120_000), 30000);
    assert.equal(tempoDeExibicaoMs("VIDEO", null, null), 15000);
});

const item = (id: string, jid: string, horasAtras: number, extra: Partial<ItemStatus> = {}): ItemStatus => ({
    id, jid, nome: jid.split("@")[0], fromMe: false, criadoEm: AGORA - horasAtras * HORA, visto: false, ...extra,
});

test("agruparStatus: separa os meus, ordena por nao visto e depois pelo mais recente", () => {
    const itens = [
        item("a1", "111@s.whatsapp.net", 5),
        item("a2", "111@s.whatsapp.net", 2),
        item("b1", "222@s.whatsapp.net", 1, { visto: true }),
        item("c1", "333@s.whatsapp.net", 10),
        item("m1", "999@s.whatsapp.net", 3, { fromMe: true }),
        item("v1", "444@s.whatsapp.net", 30), // vencido
    ];
    const r = agruparStatus(itens, AGORA);
    assert.equal(r.meus?.itens.length, 1);
    assert.deepEqual(r.contatos.map((g) => g.jid), ["111@s.whatsapp.net", "333@s.whatsapp.net", "222@s.whatsapp.net"]);
    assert.equal(r.totalNaoVistos, 3);
    const a = r.contatos[0];
    assert.deepEqual(a.itens.map((i) => i.id), ["a1", "a2"]); // do mais antigo para o mais novo
    assert.equal(a.naoVistos, 2);
    assert.equal(a.total, 2);
    assert.equal(r.contatos[2].naoVistos, 0);
});

test("agruparStatus: sem nada vigente devolve vazio", () => {
    const r = agruparStatus([item("x", "111@s.whatsapp.net", 40)], AGORA);
    assert.equal(r.meus, null);
    assert.deepEqual(r.contatos, []);
    assert.equal(r.totalNaoVistos, 0);
});

test("agruparStatus: respeita expiraEm gravado", () => {
    const r = agruparStatus([item("x", "111@s.whatsapp.net", 1, { expiraEm: AGORA - 1 })], AGORA);
    assert.deepEqual(r.contatos, []);
});

test("nomeDoAutor: agenda, depois o nome do status, depois o telefone", () => {
    assert.equal(nomeDoAutor("5546999998888@s.whatsapp.net", " Ana ", "Anita"), "Ana");
    assert.equal(nomeDoAutor("5546999998888@s.whatsapp.net", null, "Anita"), "Anita");
    assert.equal(nomeDoAutor("5546999998888@s.whatsapp.net", "", ""), "+5546999998888");
    assert.equal(nomeDoAutor("123456789012345@lid", null, null), "Contato");
});

test("validarPublicacao: status de texto", () => {
    const ok = validarPublicacao({ tipo: "TEXT", texto: "  Promoção hoje  ", fundo: "#A8650A" });
    assert.deepEqual(ok, { ok: true, dados: { tipo: "TEXT", texto: "Promoção hoje", fundo: "#a8650a", fonte: null } });
    const padrao = validarPublicacao({ tipo: "TEXT", texto: "oi" });
    assert.ok(padrao.ok && padrao.dados.fundo === COR_FUNDO_PADRAO);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "   " }).ok, false);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "x".repeat(TEXTO_STATUS_MAX + 1) }).ok, false);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fundo: "vermelho" }).ok, false);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fundo: "#12345" }).ok, false);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fonte: 99 }).ok, false);
    assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fonte: 1.5 }).ok, false);
    assert.equal(validarPublicacao({ tipo: "AUDIO", texto: "oi" }).ok, false);
});

test("validarPublicacao: foto e video com legenda, tipo e tamanho", () => {
    const foto = validarPublicacao({ tipo: "IMAGE", legenda: " olha ", arquivo: { mimetype: "image/jpeg", tamanho: 1000 } });
    assert.deepEqual(foto, { ok: true, dados: { tipo: "IMAGE", texto: "olha", fundo: null, fonte: null } });
    assert.equal(validarPublicacao({ tipo: "IMAGE", arquivo: { mimetype: "image/gif", tamanho: 1000 } }).ok, false);
    assert.equal(validarPublicacao({ tipo: "IMAGE", arquivo: { mimetype: "image/png", tamanho: IMAGEM_STATUS_MAX_BYTES + 1 } }).ok, false);
    assert.equal(validarPublicacao({ tipo: "IMAGE" }).ok, false);
    assert.equal(validarPublicacao({ tipo: "IMAGE", arquivo: { mimetype: "image/png", tamanho: 0 } }).ok, false);
    assert.equal(validarPublicacao({ tipo: "VIDEO", arquivo: { mimetype: "video/mp4; codecs=avc1", tamanho: 5_000_000 } }).ok, true);
    assert.equal(validarPublicacao({ tipo: "VIDEO", arquivo: { mimetype: "video/mp4", tamanho: VIDEO_STATUS_MAX_BYTES + 1 } }).ok, false);
    assert.equal(validarPublicacao({ tipo: "VIDEO", arquivo: { mimetype: "application/pdf", tamanho: 1000 } }).ok, false);
    assert.equal(validarPublicacao({ tipo: "VIDEO", legenda: "x".repeat(701), arquivo: { mimetype: "video/mp4", tamanho: 1000 } }).ok, false);
});

test("escolherDestinatarios: so pessoas, sem repetir, sem mim, nomeados primeiro e com teto", () => {
    const contatos = [
        { jid: "111@s.whatsapp.net".replace("111", "5511900000001"), name: null, updatedAt: AGORA },
        { jid: "5511900000002@s.whatsapp.net", name: "Ana", updatedAt: AGORA - 5 * HORA },
        { jid: "5511900000002@s.whatsapp.net", name: "Ana de novo" }, // repetido
        { jid: "5511900000003@s.whatsapp.net", name: "Bia", updatedAt: AGORA - HORA },
        { jid: "120363000000000000@g.us", name: "Grupo" },
        { jid: "status@broadcast" },
        { jid: "123456789012@lid" },
        { jid: "5511900000009@s.whatsapp.net", name: "Eu" }, // o proprio numero
        { jid: "../../etc/passwd" },
    ];
    const r = escolherDestinatarios(contatos, "5511900000009:12@s.whatsapp.net");
    assert.deepEqual(r.jids, ["5511900000003@s.whatsapp.net", "5511900000002@s.whatsapp.net", "5511900000001@s.whatsapp.net"]);
    assert.equal(r.total, 3);
    assert.equal(r.cortado, false);
    const cortado = escolherDestinatarios(contatos, null, 2);
    assert.equal(cortado.jids.length, 2);
    assert.equal(cortado.cortado, true);
});

test("validarResposta", () => {
    assert.deepEqual(validarResposta("  oi  "), { ok: true, texto: "oi" });
    assert.equal(validarResposta("   ").ok, false);
    assert.equal(validarResposta(42).ok, false);
    assert.equal(validarResposta("x".repeat(5000)).ok, false);
});

test("citacaoDoStatus aponta para o status do autor e nunca leva arquivo", () => {
    const base = { keyId: "ABC123", autorJid: "5511900000001@s.whatsapp.net" };
    const texto = citacaoDoStatus({ ...base, tipo: "TEXT", texto: "Bom dia" });
    assert.deepEqual(texto.key, { remoteJid: STATUS_JID, fromMe: false, id: "ABC123", participant: base.autorJid });
    assert.deepEqual(texto.message, { conversation: "Bom dia" });
    const foto: any = citacaoDoStatus({ ...base, tipo: "IMAGE", texto: "praia" });
    assert.deepEqual(foto.message, { imageMessage: { caption: "praia", mimetype: "image/jpeg" } });
    assert.ok(!JSON.stringify(foto).includes("url"));
    const video: any = citacaoDoStatus({ ...base, tipo: "VIDEO" });
    assert.deepEqual(video.message, { videoMessage: { caption: "", mimetype: "video/mp4" } });
});

test("tempoRelativo: agora, minutos e horas", () => {
    assert.equal(tempoRelativo(AGORA - 20_000, AGORA), "agora");
    assert.equal(tempoRelativo(AGORA + 5_000, AGORA), "agora"); // relogio um pouco adiantado
    assert.equal(tempoRelativo(AGORA - 5 * 60_000, AGORA), "há 5 min");
    assert.equal(tempoRelativo(AGORA - 59 * 60_000, AGORA), "há 59 min");
    assert.equal(tempoRelativo(AGORA - 3 * HORA - 1000, AGORA), "há 3 h");
    assert.equal(tempoRelativo("lixo", AGORA), "agora");
});

test("segundosParaPublicar: 1 publicacao por minuto por sessao", () => {
    assert.equal(segundosParaPublicar(undefined, 1000), 0);
    assert.equal(segundosParaPublicar(null, 1000), 0);
    assert.equal(segundosParaPublicar(1000, 1000), 60);
    assert.equal(segundosParaPublicar(1000, 31_000), 30);
    assert.equal(segundosParaPublicar(1000, 60_500), 1); // arredonda para cima
    assert.equal(segundosParaPublicar(1000, 61_000), 0);
    assert.equal(segundosParaPublicar(1000, 99_000), 0);
});

test("mensagemDeEsperaDoStatus: texto claro em portugues, no singular e no plural", () => {
    assert.match(mensagemDeEsperaDoStatus(1), /Aguarde 1 segundo para publicar/);
    assert.match(mensagemDeEsperaDoStatus(42), /Aguarde 42 segundos para publicar/);
});

test("destinatarios do status: teto de 256 e fonte so entre as que o WhatsApp tem", () => {
    assert.equal(DESTINATARIOS_STATUS_MAX, 256);
    const muitos = Array.from({ length: 300 }, (_, i) => ({ jid: `55119${String(10000000 + i)}@s.whatsapp.net`, updatedAt: AGORA - i }));
    const r = escolherDestinatarios(muitos, null);
    assert.equal(r.jids.length, 256);
    assert.equal(r.cortado, true);
    assert.equal(r.jids[0], "5511910000000@s.whatsapp.net"); // o mais recente primeiro
    for (const fonte of [0, 1, 2, 6, 7, 8, 9, 10]) assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fonte }).ok, true);
    for (const fonte of [3, 4, 5, 11, -1]) assert.equal(validarPublicacao({ tipo: "TEXT", texto: "oi", fonte }).ok, false, `fonte ${fonte}`);
});
