import test from "node:test";
import assert from "node:assert/strict";
import { lerTemplate } from "../mensagem-template";

test("template hidratado com imagem (alerta da Defesa Civil) vira IMAGE com o texto completo", () => {
    const lido = lerTemplate({
        templateMessage: {
            hydratedTemplate: {
                imageMessage: { mimetype: "image/jpeg" },
                hydratedTitleText: "Alerta",
                hydratedContentText: "Chuva forte prevista para hoje.",
                hydratedFooterText: "Defesa Civil",
                hydratedButtons: [{ urlButton: { displayText: "Saiba mais", url: "https://exemplo.gov.br" } }],
            },
        },
    });
    assert.deepEqual(lido, {
        tipo: "IMAGE",
        texto: "*Alerta*\nChuva forte prevista para hoje.\n_Defesa Civil_\n\n[🔘 Saiba mais]",
    });
});

test("template de quatro linhas so com texto vira TEXT", () => {
    const lido = lerTemplate({ templateMessage: { hydratedFourRowTemplate: { hydratedContentText: "Aviso" } } });
    assert.deepEqual(lido, { tipo: "TEXT", texto: "Aviso" });
});

test("mensagem de botoes le corpo, rodape e botoes", () => {
    const lido = lerTemplate({
        buttonsMessage: {
            contentText: "Confirma?",
            footerText: "Loja",
            buttons: [{ buttonText: { displayText: "Sim" } }, { buttonText: { displayText: "Nao" } }],
        },
    });
    assert.deepEqual(lido, { tipo: "TEXT", texto: "Confirma?\n_Loja_\n\n[🔘 Sim]  [🔘 Nao]" });
});

test("lista mostra secoes e itens", () => {
    const lido = lerTemplate({
        listMessage: {
            title: "Menu",
            buttonText: "Ver opcoes",
            sections: [{ title: "Pizzas", rows: [{ title: "Calabresa", description: "grande" }, { title: "Queijo" }] }],
        },
    });
    assert.deepEqual(lido, {
        tipo: "TEXT",
        texto: "*Menu*\n\n*Pizzas*\n• Calabresa — grande\n• Queijo\n\n[🔘 Ver opcoes]",
    });
});

test("template vazio nao fica sem texto", () => {
    assert.deepEqual(lerTemplate({ templateMessage: { hydratedTemplate: {} } }), { tipo: "TEXT", texto: "[Mensagem de modelo]" });
});

test("outros tipos devolvem null", () => {
    assert.equal(lerTemplate({ conversation: "oi" }), null);
    assert.equal(lerTemplate(null), null);
    assert.equal(lerTemplate({ templateMessage: {} }), null);
});
