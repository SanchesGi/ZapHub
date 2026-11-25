// minha versao: recibos por participante e o resumo do "Info da mensagem".
import test from "node:test";
import assert from "node:assert/strict";
import { mesclarRecibo, montarInfo, normalizarRecibos, paraMs } from "../recibos";
import { emSerie } from "../fila-por-chave";
import { extraParaTela } from "../midia-fila";

const A = "5511999990001@s.whatsapp.net";
const B = "5511999990002@s.whatsapp.net";

test("paraMs: segundos viram ms; ms ficam; invalido vira null", () => {
    assert.equal(paraMs(1_700_000_000), 1_700_000_000_000);
    assert.equal(paraMs(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(paraMs("1700000000"), 1_700_000_000_000);
    assert.equal(paraMs({ toString: () => "1700000000" }), 1_700_000_000_000);
    assert.equal(paraMs(0), null);
    assert.equal(paraMs(null), null);
    assert.equal(paraMs("x"), null);
});

test("normalizarRecibos: descarta lixo e mantem so numeros positivos", () => {
    assert.deepEqual(normalizarRecibos(null), {});
    assert.deepEqual(normalizarRecibos([1, 2]), {});
    assert.deepEqual(
        normalizarRecibos({ [A]: { entregue: 5, lida: "x", tocada: -1, outro: 9 }, [B]: "oi", c: {} }),
        { [A]: { entregue: 5 } }
    );
});

test("mesclarRecibo: junta sem apagar, guarda o horario mais antigo e nao duplica", () => {
    const r1 = mesclarRecibo(null, A, { entregue: 100 });
    assert.deepEqual(r1, { recibos: { [A]: { entregue: 100 } }, mudou: true });
    const r2 = mesclarRecibo(r1.recibos, A, { lida: 200 });
    assert.deepEqual(r2.recibos, { [A]: { entregue: 100, lida: 200 } });
    // mesmo recibo de novo (ou mais tardio): nada muda
    const r3 = mesclarRecibo(r2.recibos, A, { entregue: 100, lida: 250 });
    assert.equal(r3.mudou, false);
    assert.deepEqual(r3.recibos, r2.recibos);
    // um mais antigo vence
    assert.deepEqual(mesclarRecibo(r2.recibos, A, { entregue: 90 }).recibos[A], { entregue: 90, lida: 200 });
    // outro participante
    assert.deepEqual(Object.keys(mesclarRecibo(r2.recibos, B, { entregue: 5 }).recibos), [A, B]);
    // original intacto e parcial vazio nao muda
    assert.deepEqual(r1.recibos, { [A]: { entregue: 100 } });
    assert.equal(mesclarRecibo(r1.recibos, A, {}).mudou, false);
});

test("montarInfo: conversa privada usa os horarios e o status", () => {
    const sem = montarInfo({ status: "SENT", enviadaEm: 10, recibos: null });
    assert.deepEqual(sem, { enviadaEm: 10, entregue: false, entregueEm: null, lida: false, lidaEm: null, entreguePara: [], lidaPor: [] });
    const lida = montarInfo({ status: "READ", enviadaEm: 10, recibos: { [A]: { entregue: 20, lida: 30 } } });
    assert.equal(lida.entregue && lida.lida, true);
    assert.equal(lida.entregueEm, 20);
    assert.equal(lida.lidaEm, 30);
    // so o status (mensagem antiga, sem horarios): continua marcando entregue/lida
    const antiga = montarInfo({ status: "READ", enviadaEm: 10, recibos: undefined });
    assert.equal(antiga.entregue && antiga.lida, true);
    assert.equal(antiga.lidaEm, null);
});

test("montarInfo: grupo separa quem leu de quem so recebeu, em ordem de horario", () => {
    const C = "5511999990003@s.whatsapp.net";
    const i = montarInfo({
        status: "SENT", enviadaEm: 10,
        recibos: { [A]: { entregue: 40, lida: 90 }, [B]: { entregue: 30 }, [C]: { lida: 50 } },
    });
    assert.deepEqual(i.lidaPor, [{ jid: C, em: 50 }, { jid: A, em: 90 }]);
    assert.deepEqual(i.entreguePara, [{ jid: B, em: 30 }]);
    assert.equal(i.entregueEm, 30);
    assert.equal(i.lidaEm, 50);
    assert.equal(i.entregue && i.lida, true);
});

test("montarInfo: tocada conta como lida (audio/video)", () => {
    const i = montarInfo({ status: "SENT", enviadaEm: 1, recibos: { [A]: { entregue: 5, tocada: 8 } } });
    assert.deepEqual(i.lidaPor, [{ jid: A, em: 8 }]);
    assert.deepEqual(i.entreguePara, []);
});

test("extraParaTela: chave da enquete e recibos nunca vao para o navegador", () => {
    const extra = { enquete: { nome: "p", opcoes: ["a", "b"] }, enqueteSegredo: { segredo: "xx", criador: [A] }, recibos: { [A]: { entregue: 1 } }, editada: true };
    assert.deepEqual(extraParaTela(extra), { enquete: { nome: "p", opcoes: ["a", "b"] }, editada: true });
});

test("emSerie: tarefas da mesma chave rodam uma de cada vez, em ordem; erro nao trava a fila", async () => {
    const ordem: string[] = [];
    const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const t1 = emSerie("k", async () => { ordem.push("1-ini"); await espera(20); ordem.push("1-fim"); });
    const t2 = emSerie("k", async () => { ordem.push("2-ini"); throw new Error("falha"); });
    const t3 = emSerie("k", async () => { ordem.push("3"); return "ok"; });
    const outra = emSerie("outra", async () => { ordem.push("outra"); });
    await outra;
    await t1;
    await assert.rejects(t2, /falha/);
    assert.equal(await t3, "ok");
    assert.deepEqual(ordem, ["1-ini", "outra", "1-fim", "2-ini", "3"]);
});
