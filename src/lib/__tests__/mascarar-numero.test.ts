import test from "node:test";
import assert from "node:assert/strict";
import { mascararNumero } from "../mascarar-numero";

test("mostra so os 4 ultimos digitos do telefone", () => {
    assert.equal(mascararNumero("5511999998888@s.whatsapp.net"), "****8888");
    assert.equal(mascararNumero("+55 (11) 99999-1234"), "****1234");
});

test("ignora o sufixo do aparelho e entende @lid", () => {
    assert.equal(mascararNumero("5511999998888:12@s.whatsapp.net"), "****8888");
    assert.equal(mascararNumero("123456789012345@lid"), "****2345");
});

test("o numero inteiro nunca aparece no resultado", () => {
    const r = mascararNumero("5511999998888@s.whatsapp.net");
    assert.ok(!r.includes("5511999"));
    assert.ok(r.length <= 8);
});

test("vazio ou sem digitos vira desconhecido", () => {
    assert.equal(mascararNumero(""), "desconhecido");
    assert.equal(mascararNumero(null), "desconhecido");
    assert.equal(mascararNumero(undefined), "desconhecido");
    assert.equal(mascararNumero("status@broadcast"), "desconhecido");
});

test("numero curto mostra o que tem", () => {
    assert.equal(mascararNumero("123"), "****123");
});
