import test from "node:test";
import assert from "node:assert/strict";
import { descritorMidia, mensagemDoDescritor, extraParaTela } from "../midia-fila";

const msg: any = {
    key: { id: "ABC", remoteJid: "550090000101@s.whatsapp.net", fromMe: false },
    message: {
        imageMessage: {
            url: "https://mmg.exemplo/x.enc", directPath: "/v/t62/x.enc", mimetype: "image/jpeg",
            mediaKey: Buffer.from("chave-da-midia-32-bytes-exemplo!!"), jpegThumbnail: Buffer.alloc(4000, 7),
            contextInfo: { participant: "550090000999@s.whatsapp.net", quotedMessage: { conversation: "texto de outra pessoa" } },
        },
    },
};

test("descritor guarda o que o download precisa e deixa a miniatura de fora", () => {
    const d = descritorMidia(msg);
    assert.ok(!d.m.includes("jpegThumbnail"), "sem miniatura");
    assert.ok(!d.m.includes("contextInfo") && !d.m.includes("texto de outra pessoa") && !d.m.includes("550090000999"), "sem texto citado nem terceiros");
    assert.ok(d.m.length < 1000, "pequeno");
    const volta: any = mensagemDoDescritor(d);
    assert.equal(volta.key.id, "ABC");
    assert.equal(volta.message.imageMessage.directPath, "/v/t62/x.enc");
    assert.ok(Buffer.isBuffer(volta.message.imageMessage.mediaKey), "a chave volta como Buffer");
    assert.equal(volta.message.imageMessage.mediaKey.toString(), "chave-da-midia-32-bytes-exemplo!!");
});

test("a tela nunca recebe os dados de download, so se a midia falhou", () => {
    const d = descritorMidia(msg);
    assert.deepEqual(extraParaTela({ midiaOrigem: d, encaminhada: { vezes: 1 } }), { encaminhada: { vezes: 1 } });
    assert.deepEqual(extraParaTela({ midiaPendente: { ...d, falhou: true } }), { midiaPendente: { falhou: true } });
    assert.deepEqual(extraParaTela({ midiaPendente: d }), { midiaPendente: { falhou: false } });
    assert.equal(extraParaTela(null), null);
});
