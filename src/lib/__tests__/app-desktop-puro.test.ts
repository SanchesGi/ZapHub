// minha versao: funcoes puras das rotas /api/app/* (programa do Windows). Nao precisam de banco nem de Next.
import test from "node:test";
import assert from "node:assert/strict";
import { cabeNoCache, codigoHttpDoErro, destinosDeEncaminhar, duracaoDeSilencio, emojiValido, jidDeConversa, origemPermitida, keyIdValido, numeroDoJid, numeroValido, paginaValida, tipoDeImagem } from "../app-desktop-puro";

test("keyIdValido aceita so letras e numeros ate 128", () => {
    assert.equal(keyIdValido("3EB0A1B2C3D4E5F6"), true);
    assert.equal(keyIdValido(""), false);
    assert.equal(keyIdValido("a".repeat(129)), false);
    assert.equal(keyIdValido("abc/../x"), false);
    assert.equal(keyIdValido("abc def"), false);
    assert.equal(keyIdValido(42), false);
});

test("emojiValido: vazio remove, emoji passa, texto nao", () => {
    for (const ok of ["", "👍", "❤️", "👍🏽", "👨‍👩‍👧", "🇧🇷", "1️⃣"]) assert.equal(emojiValido(ok), true, ok);
    for (const ruim of ["a", "oi", "👍 ", "1", "<b>", "👍".repeat(11), "👍👍", "👍a", "❤️👍", 5, null]) assert.equal(emojiValido(ruim as never), false, String(ruim));
});

test("duracaoDeSilencio: padrao 8h, sempre, data futura e limites", () => {
    const agora = Date.parse("2026-11-13T12:00:00Z");
    assert.deepEqual(duracaoDeSilencio(undefined, agora), { ok: true, segundos: 28800 });
    assert.deepEqual(duracaoDeSilencio("sempre", agora), { ok: true, segundos: -1 });
    assert.deepEqual(duracaoDeSilencio("2026-11-13T13:00:00Z", agora), { ok: true, segundos: 3600 });
    assert.equal(duracaoDeSilencio("2026-11-13T11:00:00Z", agora).ok, false);
    assert.equal(duracaoDeSilencio("2028-01-01T00:00:00Z", agora).ok, false);
    assert.equal(duracaoDeSilencio("ontem", agora).ok, false);
    assert.equal(duracaoDeSilencio(123, agora).ok, false);
});

test("tipoDeImagem reconhece pelos bytes, nao pelo que o servidor diz", () => {
    assert.equal(tipoDeImagem(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
    assert.equal(tipoDeImagem(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
    assert.equal(tipoDeImagem(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
    assert.equal(tipoDeImagem(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
    assert.equal(tipoDeImagem(new Uint8Array()), null);
});

test("numeroValido tira a formatacao e exige 8 a 15 digitos", () => {
    assert.equal(numeroValido("+55 (41) 99999-8888"), "5541999998888");
    assert.equal(numeroValido("123"), null);
    assert.equal(numeroValido("1".repeat(16)), null);
    assert.equal(numeroValido(undefined as never), null);
});

test("paginaValida e numeroDoJid", () => {
    assert.equal(paginaValida(null), 1);
    assert.equal(paginaValida("0"), 1);
    assert.equal(paginaValida("-3"), 1);
    assert.equal(paginaValida("abc"), 1);
    assert.equal(paginaValida("7"), 7);
    assert.equal(paginaValida("99999"), 1000);
    assert.equal(numeroDoJid("5541999998888@s.whatsapp.net"), "5541999998888");
    assert.equal(numeroDoJid("5541999998888:12@s.whatsapp.net"), "5541999998888");
    assert.equal(numeroDoJid("123@lid"), null);
    assert.equal(numeroDoJid(null), null);
});

test("codigoHttpDoErro", () => {
    assert.equal(codigoHttpDoErro("Unauthorized"), 401);
    assert.equal(codigoHttpDoErro("Forbidden"), 403);
    assert.equal(codigoHttpDoErro("Session not found"), 404);
    assert.equal(codigoHttpDoErro("Mensagem não encontrada"), 404);
    assert.equal(codigoHttpDoErro("Falha ao reagir: A sessão do WhatsApp está desconectada"), 503);
    assert.equal(codigoHttpDoErro("WhatsApp session is disconnected or not found"), 503);
    assert.equal(codigoHttpDoErro("Escolha pelo menos uma conversa"), 400);
});

test("destinosDeEncaminhar: mesma regra do painel, ate 5, sem broadcast/newsletter", () => {
    const a = "5541999998888@s.whatsapp.net";
    assert.deepEqual(destinosDeEncaminhar([a, a, "123-456@g.us", "99@lid"]), { ok: true, jids: [a, "123-456@g.us", "99@lid"] });
    assert.equal(destinosDeEncaminhar([]).ok, false);
    assert.equal(destinosDeEncaminhar("x").ok, false);
    assert.equal(destinosDeEncaminhar([a, "status@broadcast"]).ok, false);
    assert.equal(destinosDeEncaminhar(["1@newsletter"]).ok, false);
    assert.equal(destinosDeEncaminhar([a, 7]).ok, false);
    const seis = Array.from({ length: 6 }, (_, i) => `55419999988${i}0@s.whatsapp.net`);
    assert.equal(destinosDeEncaminhar(seis).ok, false);
    assert.equal(destinosDeEncaminhar(seis.slice(0, 5)).ok, true);
});

test("jidDeConversa aceita so contato, @lid e grupo", () => {
    assert.equal(jidDeConversa("5541999998888@s.whatsapp.net"), true);
    assert.equal(jidDeConversa("1-2@g.us"), true);
    assert.equal(jidDeConversa("9@lid"), true);
    assert.equal(jidDeConversa("x@broadcast"), false);
    assert.equal(jidDeConversa("x@newsletter"), false);
});

test("origemPermitida: CSRF das rotas /api/app", () => {
    const real = "https://zaphub.exemplo.com.br";
    const base = { metodo: "POST", secFetchSite: null, origin: null, origemReal: real };
    assert.equal(origemPermitida(base), true); // programa nativo sem cabecalhos
    assert.equal(origemPermitida({ ...base, origin: real }), true); // programa nativo com Origin = servidor
    assert.equal(origemPermitida({ ...base, origin: "https://ZAPHUB.exemplo.com.br" }), true);
    assert.equal(origemPermitida({ ...base, origin: "https://outro.site" }), false);
    assert.equal(origemPermitida({ ...base, origin: "https://zaphub.exemplo.com.br.evil.com" }), false);
    assert.equal(origemPermitida({ ...base, origin: "https://evil.zaphub.exemplo.com.br" }), false); // same-site, outra origem
    assert.equal(origemPermitida({ ...base, origin: "null" }), false);
    assert.equal(origemPermitida({ ...base, secFetchSite: "cross-site" }), false);
    assert.equal(origemPermitida({ ...base, secFetchSite: "same-site" }), false);
    assert.equal(origemPermitida({ ...base, secFetchSite: "same-origin", origin: real }), true);
    assert.equal(origemPermitida({ ...base, secFetchSite: "none" }), true);
    assert.equal(origemPermitida({ ...base, metodo: "DELETE", origin: "https://outro.site" }), false);
    assert.equal(origemPermitida({ ...base, metodo: "GET", origin: "https://outro.site", secFetchSite: "cross-site" }), true);
    assert.equal(origemPermitida({ ...base, origemReal: "http://192.168.0.5:3005", origin: "http://192.168.0.5:3005" }), true);
    assert.equal(origemPermitida({ ...base, origemReal: "http://192.168.0.5:3005", origin: "http://192.168.0.5:9999" }), false);
});

test("cabeNoCache diz quantas fotos antigas saem para caber no teto", () => {
    assert.equal(cabeNoCache([10, 10, 10], 5, 100), 0);
    assert.equal(cabeNoCache([40, 40, 10], 30, 100), 1);
    assert.equal(cabeNoCache([40, 40, 10], 80, 100), 2);
    assert.equal(cabeNoCache([], 500, 100), 0);
});
