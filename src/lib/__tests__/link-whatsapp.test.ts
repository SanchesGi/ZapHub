import test from "node:test";
import assert from "node:assert/strict";
import { lerLinkWhatsApp } from "../link-whatsapp";

test("link do api.whatsapp.com com telefone e texto (o do pedido)", () => {
    const r = lerLinkWhatsApp("https://api.whatsapp.com/send/?phone=5500999998888&text=Ol%C3%A1%21+Fiz+o+cadastro+mas+ainda+quero+mais+informa%C3%A7%C3%B5es%2C+por+favor&type=phone_number&app_absent=0");
    assert.deepEqual(r, { numero: "5500999998888", texto: "Olá! Fiz o cadastro mas ainda quero mais informações, por favor" });
});

test("wa.me, web.whatsapp.com e whatsapp://", () => {
    assert.deepEqual(lerLinkWhatsApp("https://wa.me/5500999998888?text=Oi"), { numero: "5500999998888", texto: "Oi" });
    assert.deepEqual(lerLinkWhatsApp("https://wa.me/5500999998888"), { numero: "5500999998888", texto: "" });
    assert.deepEqual(lerLinkWhatsApp("https://web.whatsapp.com/send?phone=+55 00 99999-8888&text=Oi"), { numero: "5500999998888", texto: "Oi" });
    assert.deepEqual(lerLinkWhatsApp("whatsapp://send?phone=5500999998888&text=Oi"), { numero: "5500999998888", texto: "Oi" });
    assert.deepEqual(lerLinkWhatsApp("whatsapp://send/?phone=5500999998888"), { numero: "5500999998888", texto: "" });
});

test("so texto (compartilhar): numero nulo", () => {
    assert.deepEqual(lerLinkWhatsApp("https://wa.me/?text=Veja%20isso"), { numero: null, texto: "Veja isso" });
});

test("nao sao links de conversa", () => {
    assert.equal(lerLinkWhatsApp("https://chat.whatsapp.com/AbCdEf"), null, "convite de grupo");
    assert.equal(lerLinkWhatsApp("https://wa.me/message/ABCDEF"), null, "link curto de empresa");
    assert.equal(lerLinkWhatsApp("https://www.whatsapp.com/"), null, "pagina inicial");
    assert.equal(lerLinkWhatsApp("https://wa.me.golpe.com/5500999998888"), null, "dominio parecido");
    assert.equal(lerLinkWhatsApp("javascript:alert(1)"), null);
    assert.equal(lerLinkWhatsApp("nao e link"), null);
    assert.equal(lerLinkWhatsApp(""), null);
});

test("numero estranho vira nulo e texto e limitado", () => {
    assert.equal(lerLinkWhatsApp("https://wa.me/123?text=a")?.numero, null);
    assert.equal(lerLinkWhatsApp("https://api.whatsapp.com/send?phone=1234567890123456789")?.numero, null);
    assert.equal(lerLinkWhatsApp(`https://wa.me/5500999998888?text=${"a".repeat(6000)}`)?.texto.length, 4096);
});
