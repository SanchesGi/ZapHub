// minha versao: regras puras da enquete (validar, placar, aplicar voto) e pecas do servidor (hash, candidatos).
import test from "node:test";
import assert from "node:assert/strict";
import { aplicarVoto, lerEnquete, montarPlacar, validarEnquete } from "../enquete";
import { decifrarComCandidatos, hashOpcao, jidsCandidatos, numeroDe, opcoesDoVoto } from "../enquete-servidor";
import { motivoParaNaoEditar } from "../editar-mensagem";

test("validarEnquete: aceita pergunta e 2 a 12 opcoes, aparando espacos e ignorando opcao em branco", () => {
    const r = validarEnquete({ pergunta: "  Almoço?  ", opcoes: [" Sim ", "", "Não"], multipla: false });
    assert.deepEqual(r, { ok: true, pergunta: "Almoço?", opcoes: ["Sim", "Não"], multipla: false, selectableCount: 1 });
    const doze = Array.from({ length: 12 }, (_, i) => `op${i}`);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: doze }).ok, true);
});

test("validarEnquete: varias respostas permite escolher todas as opcoes", () => {
    const r = validarEnquete({ pergunta: "p", opcoes: ["a", "b", "c"], multipla: true });
    assert.equal(r.ok && r.selectableCount, 3);
});

test("validarEnquete: recusa pergunta vazia ou grande, poucas/muitas opcoes, repetidas e opcao grande", () => {
    assert.equal(validarEnquete({ pergunta: "  ", opcoes: ["a", "b"] }).ok, false);
    assert.equal(validarEnquete({ pergunta: "x".repeat(256), opcoes: ["a", "b"] }).ok, false);
    assert.equal(validarEnquete({ pergunta: "x".repeat(255), opcoes: ["a", "b"] }).ok, true);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: ["a"] }).ok, false);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: ["a", " "] }).ok, false);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: Array.from({ length: 13 }, (_, i) => `o${i}`) }).ok, false);
    assert.match((validarEnquete({ pergunta: "p", opcoes: ["Sim", "sim"] }) as { erro: string }).erro, /repetidas/);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: ["a", "x".repeat(101)] }).ok, false);
    assert.equal(validarEnquete({ pergunta: 5, opcoes: ["a", "b"] }).ok, false);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: "a,b" }).ok, false);
    assert.equal(validarEnquete({ pergunta: "p", opcoes: ["a", 3] }).ok, false);
});

test("lerEnquete: le o extra com seguranca e descarta votos de opcao que nao existe", () => {
    assert.equal(lerEnquete(null), null);
    assert.equal(lerEnquete({ enquete: { nome: "p" } }), null);
    const e = lerEnquete({ enquete: { nome: "p", opcoes: ["a", "b"], multipla: true, votos: { a: ["1@s.whatsapp.net", 7], z: ["2@s.whatsapp.net"] } } });
    assert.deepEqual(e, { nome: "p", opcoes: ["a", "b"], multipla: true, votos: { a: ["1@s.whatsapp.net"] } });
});

test("montarPlacar: conta votos por opcao e % sobre quem votou (cada pessoa uma vez)", () => {
    const p = montarPlacar({ opcoes: ["a", "b", "c"], votos: { a: ["x", "y"], b: ["y"] } });
    assert.equal(p.totalVotantes, 2);
    assert.deepEqual(p.opcoes.map((o) => [o.nome, o.votos, o.percentual]), [["a", 2, 100], ["b", 1, 50], ["c", 0, 0]]);
    assert.deepEqual(montarPlacar({ opcoes: ["a", "b"] }).opcoes.map((o) => o.percentual), [0, 0]);
    assert.equal(montarPlacar({ opcoes: ["a"], votos: { a: ["x", "x"] } }).opcoes[0].votos, 1);
});

test("aplicarVoto: voto novo substitui o antigo, vazio retira, e nao altera o original", () => {
    const vazio = { votos: {}, vezes: {} };
    const a = aplicarVoto(vazio, ["a", "b"], "ana", ["a"], 10);
    assert.deepEqual(a.votos, { a: ["ana"] });
    assert.deepEqual(vazio, { votos: {}, vezes: {} });
    const b = aplicarVoto(a, ["a", "b"], "ana", ["b"], 20);
    assert.deepEqual(b.votos, { b: ["ana"] });
    assert.deepEqual(a.votos, { a: ["ana"] });
    const c = aplicarVoto(b, ["a", "b"], "bia", ["a", "b"], 21);
    assert.deepEqual(c.votos, { a: ["bia"], b: ["ana", "bia"] });
    const d = aplicarVoto(c, ["a", "b"], "bia", [], 30);
    assert.deepEqual(d.votos, { b: ["ana"] });
});

test("aplicarVoto: voto mais antigo que o ja contado e ignorado; opcao desconhecida nao entra", () => {
    const base = aplicarVoto({ votos: {}, vezes: {} }, ["a", "b"], "ana", ["b"], 50);
    const velho = aplicarVoto(base, ["a", "b"], "ana", ["a"], 40);
    assert.equal(velho.mudou, false);
    assert.deepEqual(velho.votos, { b: ["ana"] });
    assert.deepEqual(aplicarVoto(base, ["a", "b"], "bia", ["zzz"], 60).votos, { b: ["ana"] });
});

test("hashOpcao e opcoesDoVoto: o voto traz o sha256 do texto da opcao", () => {
    // sha256("abc") conhecido
    assert.equal(hashOpcao("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const sel = [Buffer.from(hashOpcao("Não"), "hex"), Buffer.from("00".repeat(32), "hex"), Buffer.from(hashOpcao("Sim"), "hex")];
    assert.deepEqual(opcoesDoVoto(sel, ["Sim", "Não"]), ["Não", "Sim"]);
    assert.deepEqual(opcoesDoVoto([], ["Sim"]), []);
});

test("jidsCandidatos: tira aparelho, @c.us, vazios e repetidos", () => {
    assert.deepEqual(
        jidsCandidatos("5511:7@s.whatsapp.net", "5511@c.us", null, undefined, "semarroba", "99:1@lid", "99@lid"),
        ["5511@s.whatsapp.net", "99@lid"]
    );
});

test("decifrarComCandidatos: testa as combinacoes ate uma servir e ignora erros", () => {
    const vistos: string[] = [];
    const r = decifrarComCandidatos(["c1", "c2"], ["v1", "v2"], (c, v) => {
        vistos.push(`${c}/${v}`);
        if (c === "c1" && v === "v1") throw new Error("auth");
        return c === "c2" && v === "v1" ? "ok" : null;
    });
    assert.deepEqual(r, { resultado: "ok", criador: "c2", votante: "v1" });
    assert.deepEqual(vistos, ["c1/v1", "c1/v2", "c2/v1"]);
    assert.equal(decifrarComCandidatos(["c"], ["v"], () => null), null);
    assert.equal(decifrarComCandidatos([], ["v"], () => "x"), null);
});

test("numeroDe: aceita numero, string e Long; invalido cai no padrao", () => {
    assert.equal(numeroDe(123, 9), 123);
    assert.equal(numeroDe("456", 9), 456);
    assert.equal(numeroDe({ toString: () => "789" }, 9), 789);
    assert.equal(numeroDe(0, 9), 9);
    assert.equal(numeroDe(null, 9), 9);
    assert.equal(numeroDe("abc", 9), 9);
});

test("enquete nao pode ser editada (o texto dela e so o resumo)", () => {
    const m = { fromMe: true, type: "TEXT", timestamp: new Date(), extra: { enquete: { nome: "p", opcoes: ["a", "b"] } } };
    assert.match(motivoParaNaoEditar(m) || "", /enquete/i);
});

// minha versao: opcao com nome de propriedade do Object (constructor, toString, __proto__...) nao pode quebrar o placar nem poluir o objeto
const NOMES_PERIGOSOS = ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"];

test("montarPlacar: opcao com nome de propriedade do Object nao quebra e conta zero sem votos", () => {
    const p = montarPlacar({ opcoes: NOMES_PERIGOSOS, votos: {} });
    assert.equal(p.totalVotantes, 0);
    assert.deepEqual(p.opcoes.map((o) => o.votos), [0, 0, 0, 0, 0]);
});

test("lerEnquete + aplicarVoto: votar em opcao 'constructor' e '__proto__' grava como chave propria", () => {
    const opcoes = ["constructor", "__proto__", "toString"];
    const lida = lerEnquete({ enquete: { nome: "p", opcoes, multipla: true, votos: JSON.parse('{"__proto__":["1@s.whatsapp.net"],"constructor":"lixo"}') } });
    assert.ok(lida);
    assert.deepEqual(Object.keys(lida.votos || {}), ["__proto__"]);
    assert.equal(Object.getPrototypeOf(lida.votos), Object.prototype);

    const r = aplicarVoto({ votos: lida.votos || {}, vezes: {} }, opcoes, "2@s.whatsapp.net", ["constructor", "__proto__"], 10);
    assert.equal(r.mudou, true);
    assert.equal(Object.getPrototypeOf(r.votos), Object.prototype);
    assert.deepEqual(Object.keys(r.votos).sort(), ["__proto__", "constructor"]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(r.votos, "constructor")?.value, ["2@s.whatsapp.net"]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(r.votos, "__proto__")?.value, ["1@s.whatsapp.net", "2@s.whatsapp.net"]);

    const placar = montarPlacar({ opcoes, votos: r.votos });
    assert.equal(placar.totalVotantes, 2);
    assert.deepEqual(placar.opcoes.map((o) => o.votos), [1, 2, 0]);
    // sobrevive ao ciclo gravar/ler do banco (JSON)
    const volta = lerEnquete({ enquete: { nome: "p", opcoes, multipla: true, votos: JSON.parse(JSON.stringify(r.votos)) } });
    assert.deepEqual(montarPlacar(volta!).opcoes.map((o) => o.votos), [1, 2, 0]);
});

test("aplicarVoto: votante com nome de propriedade do Object nao e tratado como voto antigo", () => {
    const r = aplicarVoto({ votos: {}, vezes: {} }, ["a", "b"], "constructor", ["a"], 5);
    assert.equal(r.mudou, true);
    assert.equal(r.vezes["constructor"], 5);
});
