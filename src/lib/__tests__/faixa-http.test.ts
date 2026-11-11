import test from "node:test";
import assert from "node:assert/strict";
import { lerFaixa } from "../faixa-http";

test("lerFaixa: pedido de trecho de video (pular para o meio)", () => {
    assert.deepEqual(lerFaixa("bytes=0-", 1000), { inicio: 0, fim: 999 });
    assert.deepEqual(lerFaixa("bytes=500-", 1000), { inicio: 500, fim: 999 });
    assert.deepEqual(lerFaixa("bytes=100-199", 1000), { inicio: 100, fim: 199 });
    assert.deepEqual(lerFaixa("bytes=900-5000", 1000), { inicio: 900, fim: 999 }, "fim alem do arquivo e cortado");
    assert.deepEqual(lerFaixa("bytes=-100", 1000), { inicio: 900, fim: 999 }, "ultimos 100 bytes");
});

test("lerFaixa: sem Range ou formato ignorado responde o arquivo inteiro", () => {
    for (const c of [null, undefined, "", "bytes=-", "items=0-10", "bytes=0-10,20-30", "bytes=abc-"]) {
        assert.equal(lerFaixa(c as any, 1000), null, String(c));
    }
});

test("lerFaixa: faixa fora do arquivo e 416", () => {
    assert.equal(lerFaixa("bytes=1000-", 1000), "invalida");
    assert.equal(lerFaixa("bytes=50-10", 1000), "invalida");
    assert.equal(lerFaixa("bytes=-0", 1000), "invalida");
    assert.equal(lerFaixa("bytes=0-", 0), "invalida");
});
