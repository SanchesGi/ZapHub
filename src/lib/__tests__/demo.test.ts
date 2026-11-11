import test from "node:test";
import assert from "node:assert/strict";
import { bloqueadaNaDemo } from "../demo";

test("fora da demonstracao nada e bloqueado", () => {
    assert.equal(bloqueadaNaDemo("POST", "/api/system/manutencao", false), false);
});

test("na demonstracao leitura passa e escrita pela API e recusada", () => {
    assert.equal(bloqueadaNaDemo("GET", "/api/media", true), false);
    assert.equal(bloqueadaNaDemo("POST", "/api/system/manutencao", true), true);
    assert.equal(bloqueadaNaDemo("DELETE", "/api/media", true), true);
    assert.equal(bloqueadaNaDemo("put", "/api/users/1", true), true);
    assert.equal(bloqueadaNaDemo("PATCH", "/api/me/senha", true), true);
});

test("na demonstracao entrar e aceitar os termos continuam funcionando", () => {
    assert.equal(bloqueadaNaDemo("POST", "/api/auth/callback/credentials", true), false);
    assert.equal(bloqueadaNaDemo("POST", "/api/me/termos", true), false);
    assert.equal(bloqueadaNaDemo("POST", "/api/authx", true), true, "prefixo parecido nao passa");
});

test("paginas nao sao bloqueadas pelo caminho (envio ao WhatsApp e recusado no servico)", () => {
    assert.equal(bloqueadaNaDemo("POST", "/dashboard/chat/123", true), false);
});
