// minha versao: impede a volta das falhas corrigidas na auditoria de seguranca (itens 6, 7, 8, 10 e candidatos).
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { divisoesDoNome } from "../autorizar-midia";
import { criarProva, lerProva, verificarCodigoUnico } from "../dois-fatores";
import { estaBloqueado, registrarFalhaPrecheck, registrarFalhaLogin, limparFalhas } from "../login-rate";
import { definirIpDoCliente, ipDoCliente } from "../ip-cliente";
import { padraoSeguro, testarRegexSegura } from "../regex-segura";
import { limiteMidiaBytes, minimoLivreBytes, tamanhoDeclarado, lerFluxoComLimite } from "../midia-limites";

test("midia: o nome so gera candidatos; ids com traco geram varias divisoes", () => {
    assert.deepEqual(divisoesDoNome("a-b-X.jpg"), [{ sessao: "a", keyId: "b-X" }, { sessao: "a-b", keyId: "X" }]);
    assert.deepEqual(divisoesDoNome("../x-y.jpg"), []);
    assert.deepEqual(divisoesDoNome(".env"), []);
});

test("2FA: a prova e do usuario, vence e nao aceita adulteracao", () => {
    const k = "chave-de-teste";
    const p = criarProva("u1", "SEGREDO", 1000, k);
    assert.equal(lerProva(p, "u1", 2000, k), "SEGREDO");
    assert.equal(lerProva(p, "u2", 2000, k), null, "outro usuario");
    assert.equal(lerProva(p, "u1", 1000 + 11 * 60_000, k), null, "vencida");
    assert.equal(lerProva(p.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "u1", 2000, k), null, "adulterada");
    assert.equal(lerProva(p, "u1", 2000, "outra-chave"), null, "outra chave");
    assert.equal(lerProva(undefined, "u1", 2000, k), null);
});

test("2FA: um codigo TOTP nao vale duas vezes", async () => {
    const { generateSecret, generateSync } = await import("otplib");
    const segredo = generateSecret();
    const codigo = generateSync({ secret: segredo });
    assert.equal(verificarCodigoUnico("u-totp", codigo, segredo), true);
    assert.equal(verificarCodigoUnico("u-totp", codigo, segredo), false, "reuso");
    assert.equal(verificarCodigoUnico("u-totp", "000000", segredo), false);
});

test("login: falha do precheck conta no bloqueio e o login seguinte nao conta de novo", () => {
    const e = "precheck@x.com";
    limparFalhas(e);
    for (let i = 0; i < 4; i++) { registrarFalhaPrecheck(e); registrarFalhaLogin(e); } // 1 tentativa = 1 falha
    assert.equal(estaBloqueado(e), 0, "4 tentativas ainda nao bloqueiam");
    registrarFalhaPrecheck(e);
    assert.ok(estaBloqueado(e) > 0, "5a falha bloqueia");
    limparFalhas(e);
    const f = "so-precheck@x.com";
    for (let i = 0; i < 5; i++) registrarFalhaPrecheck(f); // so adivinhando pelo precheck
    assert.ok(estaBloqueado(f) > 0);
    limparFalhas(f);
});

test("IP: X-Forwarded-For do cliente nao vale; so com TRUST_PROXY e a ultima entrada", () => {
    const req = () => ({ headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9", "x-zaphub-ip": "falso" } as any, socket: { remoteAddress: "::ffff:10.0.0.5" } });
    const a = req();
    assert.equal(definirIpDoCliente(a, false), "10.0.0.5");
    assert.equal(ipDoCliente(new Headers({ "x-zaphub-ip": a.headers["x-zaphub-ip"] })), "10.0.0.5");
    const b = req();
    assert.equal(definirIpDoCliente(b, true), "9.9.9.9");
    assert.equal(ipDoCliente(new Headers({ "x-forwarded-for": "1.1.1.1" })), null);
});

test("regex de resposta automatica: padroes catastroficos nunca casam", () => {
    for (const ruim of ["(a+)+$", "(a|a)*b", "(\\w+\\s?)*$", "(a*)*", "(x+x+)+y", "(a)\\1", "a".repeat(101)]) {
        assert.equal(padraoSeguro(ruim), false, ruim);
    }
    for (const bom of ["^oi\\b", "pre[cç]o", "(oi|ola) tudo", "^\\d{3}$"]) assert.equal(padraoSeguro(bom), true, bom);
    const t0 = Date.now();
    assert.equal(testarRegexSegura("(a+)+$", "a".repeat(40) + "!"), false);
    assert.ok(Date.now() - t0 < 200);
    assert.equal(testarRegexSegura("pre[cç]o", "Qual o PREÇO?"), true);
});

test("midia recebida: limite por arquivo e espaco minimo configuraveis", async () => {
    assert.equal(limiteMidiaBytes(undefined), 100 * 1024 * 1024);
    assert.equal(limiteMidiaBytes("5"), 5 * 1024 * 1024);
    assert.equal(minimoLivreBytes(undefined), 1024 * 1024 * 1024);
    assert.equal(tamanhoDeclarado("123"), 123);
    assert.equal(tamanhoDeclarado({ toNumber: () => 7 }), 7);
    assert.equal(tamanhoDeclarado(undefined), null);
    const ok = await lerFluxoComLimite(Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), 20);
    assert.equal(ok.length, 20);
    let consumidos = 0;
    async function* infinito() { for (;;) { consumidos++; yield Buffer.alloc(1024); } }
    await assert.rejects(lerFluxoComLimite(Readable.from(infinito()), 10 * 1024), /limite/);
    assert.ok(consumidos < 50, "parou de ler ao passar do limite");
});
