import test from "node:test";
import assert from "node:assert/strict";
import { assinaturaPadrao, lerAssinatura } from "../assinatura";

test("assinatura: privada desligada; compartilhada ligada por padrao; so do dono desligada", () => {
    assert.equal(assinaturaPadrao({ privada: true, _count: { sessionAccesses: 0 } }), false);
    assert.equal(assinaturaPadrao({ privada: false, _count: { sessionAccesses: 2 } }), true);
    assert.equal(assinaturaPadrao({ privada: false, _count: { sessionAccesses: 0 } }), false);
    assert.equal(assinaturaPadrao(undefined), false);
});

test("sessao privada nunca assina, mesmo com preferencia salva", () => {
    assert.equal(lerAssinatura("s1", false, { privada: true, _count: { sessionAccesses: 3 } }), false);
    assert.equal(lerAssinatura("s1", true, { privada: false, _count: { sessionAccesses: 3 } }), true, "sem preferencia: o padrao da compartilhada");
});
