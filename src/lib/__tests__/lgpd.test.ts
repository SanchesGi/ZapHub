// minha versao: LGPD — funcoes puras (telefone do titular, datas de corte, prazos de retencao). Nao precisa de banco.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, variantesDoTitular, jidsDoTitular, dataDeCorte, lerDiasRetencao, horaNoFuso, diaNoFuso } from "../lgpd-puro";
import { VERSAO_TERMOS, VIGENCIA_TERMOS } from "../termos";

test("normalizarTelefone deixa so os digitos", () => {
    assert.equal(normalizarTelefone("+55 (46) 99999-8888"), "5546999998888");
    assert.equal(normalizarTelefone(null), "");
});

test("variantesDoTitular cobre 55 e o 9o digito, com a mesma pessoa em qualquer forma", () => {
    const esperado = ["5546999998888", "554699998888", "46999998888", "4699998888"].sort();
    for (const entrada of ["5546999998888", "(46) 99999-8888", "554699998888", "4699998888"]) {
        assert.deepEqual(variantesDoTitular(entrada).sort(), esperado, entrada);
    }
});

test("variantesDoTitular: numero estrangeiro so casa exato e termo curto nao casa nada", () => {
    assert.deepEqual(variantesDoTitular("+44 20 7183 8750"), ["442071838750"]);
    assert.deepEqual(variantesDoTitular("123"), []);
    assert.deepEqual(variantesDoTitular("1".repeat(20)), []);
});

test("jidsDoTitular monta os jids de telefone", () => {
    assert.ok(jidsDoTitular("46999998888").includes("5546999998888@s.whatsapp.net"));
});

test("dataDeCorte subtrai os dias", () => {
    const agora = new Date("2026-11-10T03:00:00Z");
    assert.equal(dataDeCorte(30, agora).toISOString(), "2026-10-11T03:00:00.000Z");
});

test("lerDiasRetencao: vazio = para sempre; menos de 30 ou nao inteiro e invalido", () => {
    assert.equal(lerDiasRetencao(null), null);
    assert.equal(lerDiasRetencao(""), null);
    assert.equal(lerDiasRetencao(30), 30);
    assert.equal(lerDiasRetencao("90"), 90);
    assert.equal(lerDiasRetencao(29), undefined);
    assert.equal(lerDiasRetencao(45.5), undefined);
    assert.equal(lerDiasRetencao("abc"), undefined);
    assert.equal(lerDiasRetencao(-5), undefined);
});

test("hora e dia no fuso do sistema", () => {
    const instante = new Date("2026-11-10T06:00:00Z"); // 03:00 em Sao Paulo (UTC-3)
    assert.equal(horaNoFuso("America/Sao_Paulo", instante), 3);
    assert.equal(diaNoFuso("America/Sao_Paulo", instante), "2026-11-10");
    assert.equal(horaNoFuso("Fuso/Invalido", instante), 6);
});

test("versao dos termos esta definida", () => {
    assert.match(VERSAO_TERMOS, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(VIGENCIA_TERMOS, /^\d{2}\/\d{2}\/\d{4}$/);
});
