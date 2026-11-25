import test from "node:test";
import assert from "node:assert/strict";
import { estadoDaPresenca, textoPresenca, JID_PRESENCA } from "../presenca";

const AGORA = new Date("2026-11-25T15:00:00").getTime();

test("estadoDaPresenca traduz os valores do WhatsApp", () => {
    assert.equal(estadoDaPresenca("composing"), "digitando");
    assert.equal(estadoDaPresenca("recording"), "gravando");
    assert.equal(estadoDaPresenca("available"), "online");
    assert.equal(estadoDaPresenca("unavailable"), "offline");
    assert.equal(estadoDaPresenca(undefined), "offline");
});

test("conversa individual: digitando, online e visto por ultimo", () => {
    const op = { grupo: false, agora: AGORA };
    assert.equal(textoPresenca([{ quem: "a", estado: "digitando", vistoEm: null }], op), "digitando…");
    assert.equal(textoPresenca([{ quem: "a", estado: "gravando", vistoEm: null }], op), "gravando áudio…");
    assert.equal(textoPresenca([{ quem: "a", estado: "online", vistoEm: null }], op), "online");
    const visto = new Date("2026-11-25T14:05:00").getTime();
    assert.match(textoPresenca([{ quem: "a", estado: "offline", vistoEm: visto }], op) || "", /^visto por último hoje às 14:05$/);
    assert.equal(textoPresenca([{ quem: "a", estado: "offline", vistoEm: null }], op), null);
});

test("grupo: mostra quem esta digitando pelo nome", () => {
    const nomes: Record<string, string> = { a: "Ana", b: "Bruno" };
    const op = { grupo: true, agora: AGORA, nomeDe: (j: string) => nomes[j] || null };
    assert.equal(textoPresenca([{ quem: "a", estado: "digitando", vistoEm: null }, { quem: "c", estado: "online", vistoEm: null }], op), "Ana está digitando…");
    assert.equal(textoPresenca([{ quem: "a", estado: "digitando", vistoEm: null }, { quem: "b", estado: "digitando", vistoEm: null }], op), "Ana e Bruno estão digitando…");
    assert.equal(textoPresenca([{ quem: "x", estado: "gravando", vistoEm: null }], op), "Alguém está gravando áudio…");
    assert.equal(textoPresenca([{ quem: "a", estado: "online", vistoEm: null }], op), null);
});

test("JID_PRESENCA aceita contato, grupo e LID e recusa o resto", () => {
    assert.ok(JID_PRESENCA.test("5511999999999@s.whatsapp.net"));
    assert.ok(JID_PRESENCA.test("120363000000000000@g.us"));
    assert.ok(JID_PRESENCA.test("123456789@lid"));
    assert.ok(!JID_PRESENCA.test("status@broadcast"));
    assert.ok(!JID_PRESENCA.test("../../etc"));
});
