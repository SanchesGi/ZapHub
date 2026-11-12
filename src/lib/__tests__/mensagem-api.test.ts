import test from "node:test";
import assert from "node:assert/strict";
import { mensagemApiSchema, paraConteudo } from "../mensagem-api";

const ok = (v: unknown) => mensagemApiSchema.safeParse(v).success;

test("texto puro e { text } sao aceitos e viram objeto", () => {
    assert.ok(ok("Olá"));
    assert.deepEqual(paraConteudo("Olá"), { text: "Olá" });
    assert.ok(ok({ text: "Olá" }));
    assert.deepEqual(paraConteudo({ text: "Olá" }), { text: "Olá" });
});

test("midia por URL http(s) com legenda e aceita", () => {
    assert.ok(ok({ image: { url: "https://exemplo.com/a.jpg" }, caption: "foto" }));
    assert.ok(ok({ document: { url: "https://exemplo.com/a.pdf" }, fileName: "a.pdf", mimetype: "application/pdf" }));
    assert.ok(ok({ audio: { url: "https://exemplo.com/a.ogg" }, ptt: true }));
    assert.ok(ok({ sticker: "https://exemplo.com/s.webp" }));
});

test("arquivo local, outros esquemas e tipos desconhecidos sao recusados", () => {
    assert.equal(ok({ image: { url: "file:///srv/zaphub/.env" } }), false, "file://");
    assert.equal(ok({ document: { url: "/etc/passwd" } }), false, "caminho local");
    assert.equal(ok({ video: { url: "ftp://exemplo.com/v.mp4" } }), false, "ftp");
    assert.equal(ok({ ptv: { url: "https://exemplo.com/v.mp4" } }), false, "tipo fora da lista");
    assert.equal(ok({ text: "oi", image: { url: "https://x.com/a.jpg", stream: true } }), false, "campo extra na midia");
    assert.equal(ok({ text: "oi", contextInfo: { quotedMessage: {} } }), false, "campo extra no conteudo");
});

test("vazio e recusado", () => {
    assert.equal(ok(""), false);
    assert.equal(ok({}), false);
    assert.equal(ok({ caption: "so legenda" }), false);
});

test("so https, uma midia por mensagem e figurinha sem texto", () => {
    assert.equal(ok({ document: { url: "http://exemplo.com/a.pdf" } }), false, "http simples (o download so aceita https)");
    assert.equal(ok({ image: { url: "https://" } }), false, "https sem endereco");
    assert.equal(ok({ image: { url: "https://x.com/a.jpg" }, video: { url: "https://x.com/v.mp4" } }), false, "duas midias");
    assert.equal(ok({ sticker: "https://x.com/s.webp", text: "oi" }), false, "figurinha com texto");
});
