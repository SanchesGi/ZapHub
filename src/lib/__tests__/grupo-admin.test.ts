import test from "node:test";
import assert from "node:assert/strict";
import {
    parteUsuarioJid, ehMesmaConta, papelNoGrupo, permissoesDoGrupo, acoesDoMembro,
    normalizarNumero, lerNumeros, interpretarResultadoAdicao, rotuloTemporarias, OPCOES_TEMPORARIAS,
    confirmouSaida, validarNomeGrupo, validarDescricaoGrupo, mensagemDeErroGrupo
} from "../grupo-admin";

test("parteUsuarioJid tira servidor e sufixo de aparelho", () => {
    assert.equal(parteUsuarioJid("5546999998888:12@s.whatsapp.net"), "5546999998888");
    assert.equal(parteUsuarioJid("123456@lid"), "123456");
    assert.equal(parteUsuarioJid(null), "");
});

test("ehMesmaConta casa por qualquer id e ignora lista vazia", () => {
    assert.equal(ehMesmaConta(["999@lid", "5546999998888@s.whatsapp.net"], ["5546999998888:3@s.whatsapp.net"]), true);
    assert.equal(ehMesmaConta(["111@lid"], ["5546999998888@s.whatsapp.net", "999@lid"]), false);
    assert.equal(ehMesmaConta(["111@lid"], [null, undefined]), false);
});

test("papelNoGrupo: criador, admin, membro e desconhecido", () => {
    const ps = [
        { id: "111@lid", phoneNumber: "5546111111111@s.whatsapp.net", admin: "superadmin" },
        { id: "222@lid", phoneNumber: "5546222222222@s.whatsapp.net", admin: "admin" },
        { id: "333@lid", phoneNumber: "5546333333333@s.whatsapp.net", admin: null }
    ];
    assert.equal(papelNoGrupo(ps, ["5546111111111:1@s.whatsapp.net"]), "superadmin");
    assert.equal(papelNoGrupo(ps, [undefined, "222@lid"]), "admin");
    assert.equal(papelNoGrupo(ps, ["5546333333333@s.whatsapp.net"]), "membro");
    assert.equal(papelNoGrupo(ps, ["5546000000000@s.whatsapp.net"]), "membro");
    assert.equal(papelNoGrupo(ps, [undefined, null]), "desconhecido");
});

test("permissoesDoGrupo: so age quem gerencia a sessao E a conta e admin", () => {
    assert.equal(permissoesDoGrupo(true, "admin").podeAgir, true);
    assert.equal(permissoesDoGrupo(true, "superadmin").podeAgir, true);
    const semGestao = permissoesDoGrupo(false, "admin");
    assert.equal(semGestao.podeAgir, false);
    assert.match(semGestao.motivoLeitura ?? "", /gerencia esta sessão/);
    const membro = permissoesDoGrupo(true, "membro");
    assert.equal(membro.podeAgir, false);
    assert.match(membro.motivoLeitura ?? "", /Só administradores do grupo podem alterar/);
    assert.equal(permissoesDoGrupo(true, "desconhecido").podeAgir, false);
});

test("acoesDoMembro: nada para o criador, para si mesmo ou sem permissao", () => {
    assert.deepEqual(acoesDoMembro(true, { admin: null }), { promover: true, rebaixar: false, remover: true });
    assert.deepEqual(acoesDoMembro(true, { admin: "admin" }), { promover: false, rebaixar: true, remover: true });
    const nenhuma = { promover: false, rebaixar: false, remover: false };
    assert.deepEqual(acoesDoMembro(true, { admin: "superadmin" }), nenhuma);
    assert.deepEqual(acoesDoMembro(true, { admin: null, souEu: true }), nenhuma);
    assert.deepEqual(acoesDoMembro(false, { admin: null }), nenhuma);
});

test("normalizarNumero: formatos brasileiros", () => {
    for (const e of ["(46) 99999-8888", "46999998888", "5546999998888", "+55 46 99999-8888", "046 99999 8888", "5546999998888@s.whatsapp.net"]) {
        const r = normalizarNumero(e);
        assert.equal(r.ok, true, e);
        if (r.ok) { assert.equal(r.numero, "5546999998888"); assert.equal(r.jid, "5546999998888@s.whatsapp.net"); }
    }
});

test("normalizarNumero: fixo e celular antigo de 8 digitos", () => {
    const fixo = normalizarNumero("(46) 3225-1234");
    assert.equal(fixo.ok && fixo.numero, "554632251234");
    const antigo = normalizarNumero("5546 8888 7777");
    assert.equal(antigo.ok && antigo.numero, "554688887777");
});

test("normalizarNumero: DDD 55 nao e confundido com o codigo do pais", () => {
    const r = normalizarNumero("55 99999-8888");
    assert.equal(r.ok && r.numero, "5555999998888");
});

test("normalizarNumero: recusa formatos invalidos com motivo", () => {
    for (const e of ["", "abc", "12345", "(46) 89999-8888", "(00) 99999-8888", "46 099999888", "https://wa.me/55", "123@lid", "grupo@g.us"]) {
        assert.equal(normalizarNumero(e).ok, false, e);
    }
    const semMais = normalizarNumero("14155550123456");
    assert.equal(semMais.ok, false);
    assert.match(!semMais.ok ? semMais.motivo : "", /\+/);
});

test("normalizarNumero: internacional so com +", () => {
    const eua = normalizarNumero("+1 415 555 0123");
    assert.equal(eua.ok && eua.numero, "14155550123");
    assert.equal(normalizarNumero("+0123456789").ok, false);
    assert.equal(normalizarNumero("+1234567").ok, false);
    assert.equal(normalizarNumero("+1234567890123456").ok, false);
    assert.equal(normalizarNumero("+55 46 1234").ok, false);
});

test("lerNumeros: varios por linha/virgula, tira repetidos e separa invalidos", () => {
    const r = lerNumeros("46999998888, (46) 98888-7777\n5546999998888;abc\n\n  +1 415 555 0123 ");
    assert.deepEqual(r.validos.map((v) => v.numero), ["5546999998888", "5546988887777", "14155550123"]);
    assert.equal(r.repetidos, 1);
    assert.equal(r.invalidos.length, 1);
    assert.equal(r.invalidos[0].entrada, "abc");
    assert.deepEqual(lerNumeros("   "), { validos: [], invalidos: [], repetidos: 0 });
});

test("interpretarResultadoAdicao: casa por numero e traduz os codigos do WhatsApp", () => {
    const enviados = [
        { numero: "5546111111111", jid: "5546111111111@s.whatsapp.net" },
        { numero: "5546222222222", jid: "5546222222222@s.whatsapp.net" },
        { numero: "5546333333333", jid: "5546333333333@s.whatsapp.net" },
        { numero: "5546444444444", jid: "5546444444444@s.whatsapp.net" }
    ];
    const resposta = [
        { status: "403", jid: "5546222222222@s.whatsapp.net", content: {} },
        { status: "200", jid: "5546111111111@s.whatsapp.net" },
        { status: "409", jid: "5546333333333@s.whatsapp.net" }
    ];
    const r = interpretarResultadoAdicao(resposta, enviados);
    assert.deepEqual(r.map((x) => x.situacao), ["adicionado", "convite", "ja_no_grupo", "sem_resposta"]);
    assert.deepEqual(r.map((x) => x.ok), [true, false, false, false]);
    assert.match(r[1].mensagem, /link de convite/);
});

test("interpretarResultadoAdicao: cai para a ordem quando o WhatsApp responde com LID", () => {
    const enviados = [{ numero: "5546111111111", jid: "5546111111111@s.whatsapp.net" }, { numero: "5546222222222", jid: "5546222222222@s.whatsapp.net" }];
    const r = interpretarResultadoAdicao([{ status: "200", jid: "1@lid" }, { status: "404", jid: "2@lid" }], enviados);
    assert.deepEqual(r.map((x) => x.situacao), ["adicionado", "sem_whatsapp"]);
    assert.equal(interpretarResultadoAdicao("lixo", enviados)[0].situacao, "sem_resposta");
    assert.equal(interpretarResultadoAdicao([{ status: "500", jid: "5546111111111@s.whatsapp.net" }], [enviados[0]])[0].situacao, "falhou");
});

test("mensagens temporarias: opcoes e rotulos", () => {
    assert.deepEqual(OPCOES_TEMPORARIAS.map((o) => o.valor), [0, 86400, 604800, 7776000]);
    assert.equal(rotuloTemporarias(undefined), "Desligadas");
    assert.equal(rotuloTemporarias(86400), "24 horas");
    assert.equal(rotuloTemporarias(7776000), "90 dias");
    assert.equal(rotuloTemporarias(172800), "2 dias");
});

test("confirmouSaida exige a palavra SAIR", () => {
    assert.equal(confirmouSaida("sair"), true);
    assert.equal(confirmouSaida(" SAIR "), true);
    assert.equal(confirmouSaida("sai"), false);
    assert.equal(confirmouSaida(""), false);
});

test("validar nome e descricao do grupo", () => {
    assert.equal(validarNomeGrupo("Equipe"), null);
    assert.notEqual(validarNomeGrupo("   "), null);
    assert.notEqual(validarNomeGrupo("a".repeat(101)), null);
    assert.equal(validarNomeGrupo("a".repeat(100)), null);
    assert.equal(validarDescricaoGrupo(""), null);
    assert.notEqual(validarDescricaoGrupo("a".repeat(513)), null);
});

test("mensagemDeErroGrupo traduz o status da API", () => {
    assert.equal(mensagemDeErroGrupo(403, "Sem permissão: esta ação é só para Supervisor", "x"), "Sem permissão: esta ação é só para Supervisor");
    assert.match(mensagemDeErroGrupo(403, "Bot must be admin to update group members", "x"), /não é administradora/);
    assert.match(mensagemDeErroGrupo(503, "Session not ready", "x"), /não está conectada/);
    assert.match(mensagemDeErroGrupo(500, "Failed", "remover o membro"), /remover o membro/);
    assert.match(mensagemDeErroGrupo(401, null, "x"), /expirou/);
});
