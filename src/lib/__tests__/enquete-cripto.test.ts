// minha versao: ida e volta do voto cifrado. O voto e cifrado aqui seguindo o protocolo do WhatsApp (HMAC-SHA256 +
// AES-256-GCM) e lido com decryptPollVote do Baileys + as pecas do painel (candidatos de JID e hash das opcoes).
import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { decryptPollVote, proto } from "@whiskeysockets/baileys";
import { decifrarComCandidatos, hashOpcao, jidsCandidatos, opcoesDoVoto } from "../enquete-servidor";

function cifrarVoto(opcoes: string[], c: { segredo: Buffer; criador: string; enqueteId: string; votante: string }) {
    const texto = Buffer.from(proto.Message.PollVoteMessage.encode({ selectedOptions: opcoes.map((o) => Buffer.from(hashOpcao(o), "hex")) }).finish());
    const sign = Buffer.concat([Buffer.from(c.enqueteId), Buffer.from(c.criador), Buffer.from(c.votante), Buffer.from("Poll Vote"), Buffer.from([1])]);
    const key0 = createHmac("sha256", Buffer.alloc(32)).update(c.segredo).digest();
    const chave = createHmac("sha256", key0).update(sign).digest();
    const iv = randomBytes(12);
    const cifra = createCipheriv("aes-256-gcm", chave, iv);
    cifra.setAAD(Buffer.from(`${c.enqueteId}\u0000${c.votante}`));
    const encPayload = Buffer.concat([cifra.update(texto), cifra.final(), cifra.getAuthTag()]);
    return { encPayload, encIv: iv };
}

test("voto cifrado: acha a combinacao certa de JIDs (telefone x lid) e as opcoes escolhidas", () => {
    const opcoes = ["Sim", "Não", "Talvez"];
    const segredo = randomBytes(32);
    const enqueteId = "3EB0ABCDEF";
    // o WhatsApp usou o telefone do criador e o @lid do votante
    const voto = cifrarVoto(["Não", "Talvez"], { segredo, enqueteId, criador: "5511900000000@s.whatsapp.net", votante: "1234567890@lid" });

    const criadores = jidsCandidatos("1111@lid", "5511900000000:3@s.whatsapp.net");
    const votantes = jidsCandidatos("5511988887777@s.whatsapp.net", "1234567890:9@lid");
    const achado = decifrarComCandidatos(criadores, votantes, (criador, votante) =>
        decryptPollVote(voto, { pollCreatorJid: criador, pollMsgId: enqueteId, pollEncKey: segredo, voterJid: votante }));

    assert.ok(achado);
    assert.equal(achado.criador, "5511900000000@s.whatsapp.net");
    assert.equal(achado.votante, "1234567890@lid");
    assert.deepEqual(opcoesDoVoto(achado.resultado.selectedOptions, opcoes), ["Não", "Talvez"]);
});

test("voto cifrado: JIDs errados nao decifram (cifra autenticada)", () => {
    const segredo = randomBytes(32);
    const voto = cifrarVoto(["Sim"], { segredo, enqueteId: "X1", criador: "a@s.whatsapp.net", votante: "b@s.whatsapp.net" });
    const achado = decifrarComCandidatos(["a@s.whatsapp.net"], ["c@s.whatsapp.net"], (criador, votante) =>
        decryptPollVote(voto, { pollCreatorJid: criador, pollMsgId: "X1", pollEncKey: segredo, voterJid: votante }));
    assert.equal(achado, null);
});

test("voto cifrado: voto vazio (retirado) decifra como nenhuma opcao", () => {
    const segredo = randomBytes(32);
    const voto = cifrarVoto([], { segredo, enqueteId: "X2", criador: "a@s.whatsapp.net", votante: "b@s.whatsapp.net" });
    const v = decryptPollVote(voto, { pollCreatorJid: "a@s.whatsapp.net", pollMsgId: "X2", pollEncKey: segredo, voterJid: "b@s.whatsapp.net" });
    assert.deepEqual(opcoesDoVoto(v.selectedOptions, ["Sim", "Não"]), []);
});
