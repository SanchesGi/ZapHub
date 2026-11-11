import test from "node:test";
import assert from "node:assert/strict";
import { destinoSeguro } from "../destino-seguro";
import { prepararMidiaSegura } from "../midia-segura";

test("destinoSeguro aceita caminhos internos", () => {
    assert.equal(destinoSeguro("/dashboard/chat?x=1"), "/dashboard/chat?x=1");
    assert.equal(destinoSeguro("/"), "/");
});

test("destinoSeguro recusa destinos externos e truques de URL", () => {
    for (const ruim of [
        "javascript:alert(1)", "https://exemplo.invalid/", "//exemplo.invalid", "/\\exemplo.invalid",
        "/a\\b", "/\t/exemplo.invalid", "\t//exemplo.invalid", "dashboard", "", null, undefined,
    ]) {
        assert.equal(destinoSeguro(ruim), "/dashboard", String(ruim));
    }
});

const baixados: string[] = [];
const buscarFalso = async (url: string) => {
    baixados.push(url);
    return Buffer.from("ok");
};

test("toda URL de midia passa pela busca validada e vira Buffer", async () => {
    baixados.length = 0;
    const saida: any = await prepararMidiaSegura({
        caption: "oi",
        document: { url: ".env" },
        image: { url: "https://exemplo.invalid/a.png" },
        albumMessage: [{ video: { url: "/etc/passwd" } }],
        header: { image: { url: "file:///etc/passwd" } },
        thumbnail: "https://exemplo.invalid/t.png",
    }, buscarFalso);
    assert.deepEqual(baixados.sort(), [
        ".env", "/etc/passwd", "file:///etc/passwd", "https://exemplo.invalid/a.png", "https://exemplo.invalid/t.png",
    ].sort());
    assert.ok(Buffer.isBuffer(saida.document));
    assert.ok(Buffer.isBuffer(saida.albumMessage[0].video));
    assert.ok(Buffer.isBuffer(saida.header.image));
    assert.ok(Buffer.isBuffer(saida.thumbnail));
    assert.equal(saida.caption, "oi");
});

test("recusa url que nao e texto e stream vindo do cliente", async () => {
    await assert.rejects(prepararMidiaSegura({ document: { url: ["/etc/passwd"] } }, buscarFalso));
    await assert.rejects(prepararMidiaSegura({ document: { stream: {} } }, buscarFalso));
});

test("nao mexe em Buffer, em data: nem em URL fora de midia", async () => {
    baixados.length = 0;
    const b = Buffer.from("x");
    const saida: any = await prepararMidiaSegura({
        image: b,
        video: { url: "data:video/mp4;base64,AAAA" },
        buttons: [{ url: "https://exemplo.invalid/botao" }],
        text: "/etc/passwd",
    }, buscarFalso);
    assert.equal(saida.image, b);
    assert.equal(saida.video.url, "data:video/mp4;base64,AAAA");
    assert.equal(saida.buttons[0].url, "https://exemplo.invalid/botao");
    assert.equal(baixados.length, 0);
});

test("mantem instancias intactas, como o Long do protobuf", async () => {
    class Longo { toNumber() { return 1; } }
    const longo = new Longo();
    const saida: any = await prepararMidiaSegura({ forward: { messageTimestamp: longo } }, buscarFalso);
    assert.equal(saida.forward.messageTimestamp, longo);
});

test("limita a quantidade de downloads por mensagem", async () => {
    const itens = Array.from({ length: 21 }, () => ({ image: { url: "https://exemplo.invalid/a.png" } }));
    await assert.rejects(prepararMidiaSegura({ albumMessage: itens }, buscarFalso));
});
