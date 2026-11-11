// minha versao: um contato nao pode editar/apagar mensagem de outra pessoa (auditoria, item 9).
import test from "node:test";
import assert from "node:assert/strict";
import { autorDoProtocolo, ehAdmin } from "../store/autoria-protocolo";

const dm = { remoteJid: "5511@s.whatsapp.net", fromMe: false, senderJid: "5511@s.whatsapp.net" };
const grupo = { remoteJid: "g1@g.us", fromMe: false, senderJid: "5522@s.whatsapp.net" };

test("1 a 1: o contato edita e apaga a propria mensagem", () => {
    const p = { chat: ["5511@s.whatsapp.net"], remetente: ["5511@s.whatsapp.net"], fromMe: false };
    assert.equal(autorDoProtocolo(dm, p, "editar"), true);
    assert.equal(autorDoProtocolo(dm, p, "apagar"), true);
});

test("outro chat: nao mexe em mensagem de conversa diferente", () => {
    const p = { chat: ["5599@s.whatsapp.net"], remetente: ["5599@s.whatsapp.net"], fromMe: false };
    assert.equal(autorDoProtocolo(dm, p, "editar"), false);
    assert.equal(autorDoProtocolo(dm, p, "apagar"), false);
});

test("mensagem minha: so um aparelho meu mexe", () => {
    const minha = { remoteJid: "5511@s.whatsapp.net", fromMe: true, senderJid: null };
    assert.equal(autorDoProtocolo(minha, { chat: ["5511@s.whatsapp.net"], remetente: [], fromMe: false }, "editar"), false);
    assert.equal(autorDoProtocolo(minha, { chat: ["5511@s.whatsapp.net"], remetente: [], fromMe: false }, "apagar"), false);
    assert.equal(autorDoProtocolo(minha, { chat: ["5511@s.whatsapp.net"], remetente: [], fromMe: true }, "editar"), true);
});

test("grupo: so o autor edita; admin ou este numero apagam", () => {
    const autor = { chat: ["g1@g.us"], remetente: ["5522:7@s.whatsapp.net"], fromMe: false };
    const outro = { chat: ["g1@g.us"], remetente: ["5533@s.whatsapp.net"], fromMe: false };
    assert.equal(autorDoProtocolo(grupo, autor, "editar"), true, "autor com sufixo de aparelho");
    assert.equal(autorDoProtocolo(grupo, outro, "editar"), false);
    assert.equal(autorDoProtocolo(grupo, outro, "apagar"), false);
    assert.equal(autorDoProtocolo(grupo, { ...outro, ehAdminDoGrupo: true }, "apagar"), true);
    assert.equal(autorDoProtocolo(grupo, { ...outro, ehAdminDoGrupo: true }, "editar"), false);
    assert.equal(autorDoProtocolo(grupo, { chat: ["g1@g.us"], remetente: [], fromMe: true }, "apagar"), true);
    assert.equal(autorDoProtocolo(grupo, { chat: ["g1@g.us"], remetente: [], fromMe: true }, "editar"), false);
});

test("lid e telefone: vale qualquer forma conhecida do autor", () => {
    const g = { ...grupo, senderJid: "5522@s.whatsapp.net" };
    assert.equal(autorDoProtocolo(g, { chat: ["g1@g.us"], remetente: ["abc@lid", "5522@s.whatsapp.net"], fromMe: false }, "editar"), true);
    assert.equal(ehAdmin([{ id: "5533@s.whatsapp.net", admin: "admin" }], ["x@lid", "5533@s.whatsapp.net"]), true);
    assert.equal(ehAdmin([{ id: "5533@s.whatsapp.net", admin: null }], ["5533@s.whatsapp.net"]), false);
});
