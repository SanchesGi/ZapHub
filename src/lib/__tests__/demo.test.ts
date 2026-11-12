import test from "node:test";
import assert from "node:assert/strict";
import { bloqueadaNaDemo, chaveDeBloqueio } from "../demo";

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

test("na demonstracao registros de acesso, logs, manutencao e exportacao ficam fechados ate para leitura", () => {
    for (const c of ["/api/logs-acesso", "/api/system/logs", "/api/system/manutencao", "/api/system/armazenamento", "/api/me/dados", "/api/system/logs/servico"]) {
        assert.equal(bloqueadaNaDemo("GET", c, true), true, c);
    }
    assert.equal(bloqueadaNaDemo("GET", "/api/system/logsx", true), false, "prefixo parecido nao e fechado");
    assert.equal(bloqueadaNaDemo("GET", "/api/logs-acesso", false), false, "fora da demo continua aberto");
});

test("bloqueio de login: na demo a conta publica e travada por IP; as outras, por e-mail", () => {
    assert.equal(chaveDeBloqueio("demo@zaphub.demo", "1.2.3.4", true), "demo@zaphub.demo|1.2.3.4");
    assert.equal(chaveDeBloqueio("DEMO@zaphub.demo ", "1.2.3.4", true), "DEMO@zaphub.demo |1.2.3.4");
    assert.equal(chaveDeBloqueio("ana@empresa.com", "1.2.3.4", true), "ana@empresa.com");
    assert.equal(chaveDeBloqueio("demo@zaphub.demo", "1.2.3.4", false), "demo@zaphub.demo", "fora da demo: por e-mail");
});
