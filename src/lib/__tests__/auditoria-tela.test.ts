// minha versao: a logica pura da tela de Auditoria (frases dos cartoes, dias, periodo, conversas apagadas).
import test from "node:test";
import assert from "node:assert/strict";
import {
    agruparPorDia, chaveDoGrupo, condicaoDoTipo, dataCurta, ehPeriodo, ehTipoFiltro, escritaPor, fraseDaConversa,
    fraseDoRegistro, horaCurta, inicioDoPeriodo, lerDataIso, linhaDaConversa, mesclarPagina, rotuloDoDia, telefoneBonito,
} from "../auditoria-tela";

const BRASILIA = 180; // Date.getTimezoneOffset() de Brasilia (UTC-3)

test("frase do cartao: uma frase simples para cada origem e modo", () => {
    assert.equal(fraseDoRegistro({ origem: "PAINEL", modo: "TODOS", usuarioNome: "Maria (atendente)" }), "Maria (atendente) apagou para todos, pelo painel");
    assert.equal(fraseDoRegistro({ origem: "PAINEL", modo: "PARA_MIM", usuarioNome: "Maria" }), "Maria apagou só para este número, pelo painel");
    assert.equal(fraseDoRegistro({ origem: "PAINEL", modo: null, usuarioNome: null }), "Alguém apagou, pelo painel");
    assert.equal(fraseDoRegistro({ origem: "CONTATO", modo: "TODOS", usuarioNome: "João Silva" }), "O contato João Silva apagou para todos");
    assert.equal(fraseDoRegistro({ origem: "CONTATO", modo: "TODOS", usuarioNome: "  " }), "O contato apagou para todos");
    assert.equal(fraseDoRegistro({ origem: "CELULAR", modo: "TODOS", usuarioNome: "Este número (celular)" }), "Este número apagou para todos, pelo celular");
    assert.equal(fraseDoRegistro({ origem: "CELULAR", modo: "PARA_MIM", usuarioNome: "Este número (celular)" }), "Este número apagou só para si, pelo celular — a mensagem sumiu do painel");
});

test("frase da conversa apagada: conta mensagens no singular e no plural, e distingue grupo", () => {
    assert.equal(fraseDaConversa({ chatJid: "5546999998888@s.whatsapp.net", chatNome: "João Silva" }, 12), "A conversa com João Silva foi apagada pelo celular (12 mensagens)");
    assert.equal(fraseDaConversa({ chatJid: "5546999998888@s.whatsapp.net", chatNome: null }, 1), "A conversa com +55 (46) 99999-8888 foi apagada pelo celular (1 mensagem)");
    assert.equal(fraseDaConversa({ chatJid: "123@g.us", chatNome: "Equipe" }, 3), "O grupo Equipe foi apagado pelo celular (3 mensagens)");
    assert.equal(fraseDaConversa({ chatJid: "999@lid", chatNome: null }, 2), "A conversa com um contato foi apagada pelo celular (2 mensagens)");
});

test("linha da conversa e quem escreveu", () => {
    assert.equal(
        linhaDaConversa({ chatJid: "5546999998888@s.whatsapp.net", chatNome: "João Silva", sessaoNome: "Suporte" }),
        "Conversa com João Silva (+55 (46) 99999-8888), na sessão Suporte",
    );
    assert.equal(linhaDaConversa({ chatJid: "5546999998888@s.whatsapp.net", chatNome: "+55 (46) 99999-8888", sessaoNome: "Suporte", sessaoDono: "Ana" }),
        "Conversa com +55 (46) 99999-8888, na sessão Suporte de Ana");
    assert.equal(linhaDaConversa({ chatJid: "123@g.us", chatNome: "Equipe", sessaoNome: null }), "Grupo Equipe");
    assert.equal(escritaPor({ fromMe: false, autorNome: "João" }), "escrita por João");
    assert.equal(escritaPor({ fromMe: true, autorNome: "Você · Maria" }), "escrita por Maria, pelo ZapHub");
    assert.equal(escritaPor({ fromMe: true, autorNome: "Você (este número)" }), "escrita por este número");
    assert.equal(escritaPor({ fromMe: false, autorNome: null }), "autor não identificado");
});

test("telefone: formata numero do Brasil e ignora o que nao e telefone", () => {
    assert.equal(telefoneBonito("554699998888@s.whatsapp.net"), "+55 (46) 9999-8888");
    assert.equal(telefoneBonito("14155550123@s.whatsapp.net"), "+14155550123");
    assert.equal(telefoneBonito("123@g.us"), null);
    assert.equal(telefoneBonito(null), null);
});

test("periodo: Hoje comeca na meia-noite de quem olha; 7 e 30 dias contam para tras; Tudo nao limita", () => {
    const agora = new Date("2026-11-25T17:30:00.000Z"); // 14:30 em Brasilia
    assert.equal(inicioDoPeriodo("hoje", agora, BRASILIA)?.toISOString(), "2026-11-25T03:00:00.000Z");
    assert.equal(inicioDoPeriodo("hoje", agora, 0)?.toISOString(), "2026-11-25T00:00:00.000Z");
    // 01:00 em Brasilia ainda e "hoje" 25/11 la, mesmo sendo 04:00 UTC do mesmo dia; e 23:00 de 24/11 em Brasilia = 02:00 UTC de 25/11
    assert.equal(inicioDoPeriodo("hoje", new Date("2026-11-25T02:00:00.000Z"), BRASILIA)?.toISOString(), "2026-11-24T03:00:00.000Z");
    assert.equal(inicioDoPeriodo("7d", agora)?.toISOString(), "2026-11-18T17:30:00.000Z");
    assert.equal(inicioDoPeriodo("30d", agora)?.toISOString(), "2026-10-26T17:30:00.000Z");
    assert.equal(inicioDoPeriodo("tudo", agora), null);
});

test("validacao dos filtros", () => {
    assert.ok(ehPeriodo("hoje") && ehPeriodo("tudo"));
    assert.ok(!ehPeriodo("ontem") && !ehPeriodo(undefined) && !ehPeriodo("7D"));
    assert.ok(ehTipoFiltro("CONVERSA") && ehTipoFiltro("CELULAR"));
    assert.ok(!ehTipoFiltro("TODOS") && !ehTipoFiltro("") && !ehTipoFiltro(null));
    assert.deepEqual(condicaoDoTipo("CONVERSA"), { acao: "CONVERSA_APAGADA" });
    assert.deepEqual(condicaoDoTipo("CELULAR"), { origem: "CELULAR", acao: "MENSAGEM_APAGADA" });
    assert.deepEqual(condicaoDoTipo("PAINEL"), { origem: "PAINEL", acao: "MENSAGEM_APAGADA" });
    assert.deepEqual(condicaoDoTipo("CONTATO"), { origem: "CONTATO", acao: "MENSAGEM_APAGADA" });
});

test("datas: hora, data e rotulo (Hoje, Ontem, dd/mm/aaaa) no fuso de quem olha", () => {
    assert.equal(horaCurta("2026-11-25T17:32:00.000Z", BRASILIA), "14:32");
    assert.equal(dataCurta("2026-11-25T17:32:00.000Z", BRASILIA), "25/11/2026");
    assert.equal(horaCurta("lixo", BRASILIA), "—");
    const agora = new Date("2026-11-25T17:30:00.000Z");
    assert.equal(rotuloDoDia("2026-11-25T03:00:00.000Z", agora, BRASILIA), "Hoje");
    assert.equal(rotuloDoDia("2026-11-25T02:59:00.000Z", agora, BRASILIA), "Ontem"); // 23:59 de 24/11 em Brasilia
    assert.equal(rotuloDoDia("2026-11-24T02:59:00.000Z", agora, BRASILIA), "23/11/2026");
    assert.equal(rotuloDoDia("sem data", agora, BRASILIA), "Sem data");
});

test("agrupar por dia: mantem a ordem e junta o mesmo dia", () => {
    const agora = new Date("2026-11-25T17:30:00.000Z");
    const itens = [
        { id: 1, criadoEm: "2026-11-25T16:00:00.000Z" },
        { id: 2, criadoEm: "2026-11-25T05:00:00.000Z" },
        { id: 3, criadoEm: "2026-11-24T20:00:00.000Z" },
        { id: 4, criadoEm: "2026-11-20T12:00:00.000Z" },
        { id: 5, criadoEm: "2026-11-20T10:00:00.000Z" },
    ];
    const grupos = agruparPorDia(itens, agora, BRASILIA);
    assert.deepEqual(grupos.map((g) => g.rotulo), ["Hoje", "Ontem", "20/11/2026"]);
    assert.deepEqual(grupos.map((g) => g.itens.map((i) => i.id)), [[1, 2], [3], [4, 5]]);
    assert.deepEqual(agruparPorDia([], agora, BRASILIA), []);
});

test("data ISO dos parametros: so aceita instante completo", () => {
    assert.equal(lerDataIso("2026-11-25T17:32:00.123Z")?.getTime(), Date.parse("2026-11-25T17:32:00.123Z"));
    assert.equal(lerDataIso("2026-11-25"), null);
    assert.equal(lerDataIso("amanha"), null);
    assert.equal(lerDataIso("2026-13-45T99:99:99Z"), null);
    assert.equal(lerDataIso(undefined), null);
    assert.equal(lerDataIso("2026-11-25T17:32:00Z' OR 1=1"), null);
});

test("conversas apagadas: a chave do grupo e a mesma para Date e para texto", () => {
    const a = chaveDoGrupo({ sessionId: "s1", chatJid: "1@s.whatsapp.net", criadoEm: new Date("2026-11-25T17:32:00.123Z") });
    const b = chaveDoGrupo({ sessionId: "s1", chatJid: "1@s.whatsapp.net", criadoEm: "2026-11-25T17:32:00.123Z" });
    assert.equal(a, b);
    assert.equal(a, "s1|1@s.whatsapp.net|2026-11-25T17:32:00.123Z");
});

test("juntar paginas: mensagens soltas e conversas apagadas, da mais nova para a mais antiga", () => {
    const soltas = [
        { id: "m1", criadoEm: new Date("2026-11-25T12:00:00Z") },
        { id: "m2", criadoEm: new Date("2026-11-25T10:00:00Z") },
        { id: "m3", criadoEm: new Date("2026-11-24T10:00:00Z") },
        { id: "m4", criadoEm: new Date("2026-11-23T10:00:00Z") },
    ];
    const grupos = [
        { id: "c1", criadoEm: new Date("2026-11-25T11:00:00Z"), total: 40 },
        { id: "c2", criadoEm: new Date("2026-11-22T11:00:00Z"), total: 5 },
    ];
    const ids = (p: ReturnType<typeof mesclarPagina>) => p.map((x) => (x.item as any).id);
    assert.deepEqual(ids(mesclarPagina(soltas, grupos, 1, 3)), ["m1", "c1", "m2"]);
    assert.deepEqual(ids(mesclarPagina(soltas, grupos, 2, 3)), ["m3", "m4", "c2"]);
    assert.deepEqual(ids(mesclarPagina(soltas, grupos, 3, 3)), []);
    assert.equal(mesclarPagina(soltas, grupos, 1, 3)[1].tipo, "conversa");
    assert.deepEqual(ids(mesclarPagina([], grupos, 1, 25)), ["c1", "c2"]);
});
