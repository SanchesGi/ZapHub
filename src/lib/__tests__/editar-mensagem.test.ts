// minha versao: regra de editar mensagem enviada (propria, texto, ate 15 minutos, nao apagada).
import test from "node:test";
import assert from "node:assert/strict";
import { motivoParaNaoEditar, PRAZO_EDICAO_MS, textoDeEdicao } from "../editar-mensagem";

const agora = Date.parse("2026-11-14T12:00:00Z");
const base = { fromMe: true, type: "TEXT", timestamp: new Date(agora - 60_000), extra: null };

test("pode editar texto proprio recente", () => {
    assert.equal(motivoParaNaoEditar(base, agora), null);
    assert.equal(motivoParaNaoEditar({ ...base, timestamp: new Date(agora - 60_000).toISOString() }, agora), null);
    assert.equal(motivoParaNaoEditar({ ...base, type: null }, agora), null);
});

test("nao edita mensagem de outra pessoa, midia, apagada ou sem data", () => {
    assert.match(motivoParaNaoEditar({ ...base, fromMe: false }, agora) || "", /enviadas por você/);
    assert.match(motivoParaNaoEditar({ ...base, type: "IMAGE" }, agora) || "", /texto/);
    assert.match(motivoParaNaoEditar({ ...base, extra: { apagada: true } }, agora) || "", /apagada/);
    assert.match(motivoParaNaoEditar({ ...base, timestamp: null }, agora) || "", /sem data/);
});

test("prazo de 15 minutos do WhatsApp", () => {
    assert.equal(motivoParaNaoEditar({ ...base, timestamp: new Date(agora - PRAZO_EDICAO_MS) }, agora), null);
    assert.match(motivoParaNaoEditar({ ...base, timestamp: new Date(agora - PRAZO_EDICAO_MS - 1000) }, agora) || "", /15 minutos/);
});

test("texto novo: aparado, nao vazio, com limite", () => {
    assert.deepEqual(textoDeEdicao("  oi  "), { ok: true, texto: "oi" });
    assert.equal(textoDeEdicao("   ").ok, false);
    assert.equal(textoDeEdicao(42).ok, false);
    assert.equal(textoDeEdicao("x".repeat(65537)).ok, false);
});
