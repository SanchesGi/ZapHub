// minha versao: emojis do painel (dados do emojibase-data em portugues): categorias, busca, tom de pele, linhas, recentes e cursor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    LIMITE_BUSCA, MAX_RECENTES, adicionarRecente, aplicarTomSimples, buscarEmojis, inserirNoCursor, lerRecentes, montarCategorias, montarLinhas,
    normalizarBusca, normalizarTom, resolverTons, serializarRecentes, tomValido, variantePorTom, type DadoEmoji,
} from "../emojis";
import { esquemaPreferencias } from "../preferencias-usuario";

const MOD = ["🏻", "🏼", "🏽", "🏾", "🏿"];
const MODHEX = ["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
const pele = (hex: string, base: string): { hexcode: string; unicode: string }[] =>
    MODHEX.map((m, i) => ({ hexcode: hex.replace("{m}", m), unicode: base + MOD[i] }));

const DUAS_PESSOAS: DadoEmoji = {
    hexcode: "1F9D1-200D-1F91D-200D-1F9D1", label: "pessoas de mãos dadas", unicode: "🧑‍🤝‍🧑", group: 1, order: 3124, tags: ["amigos", "parceria"],
    skins: [
        // misturado primeiro: a variante que vale e a de um tom so em todas as pessoas
        { hexcode: "1F9D1-1F3FB-200D-1F91D-200D-1F9D1-1F3FC", unicode: "🧑🏻‍🤝‍🧑🏼" },
        ...MODHEX.map((m, i) => ({ hexcode: `1F9D1-${m}-200D-1F91D-200D-1F9D1-${m}`, unicode: `🧑${MOD[i]}‍🤝‍🧑${MOD[i]}` })),
    ],
};

// amostra pequena no mesmo formato do pt/compact.json
const AMOSTRA: DadoEmoji[] = [
    { hexcode: "1F44D", label: "polegar para cima", unicode: "👍", group: 1, order: 354, tags: ["beleza", "joia", "ok"], skins: pele("1F44D-{m}", "👍") },
    { hexcode: "1F600", label: "rosto risonho", unicode: "😀", group: 0, order: 1, tags: ["engraçado", "feliz", "risada"] },
    { hexcode: "1F494", label: "coração partido", unicode: "💔", group: 0, order: 150, tags: ["coração", "triste", "decepção"] },
    { hexcode: "2764", label: "coração vermelho", unicode: "❤️", group: 0, order: 151, tags: ["amor", "romance"] },
    { hexcode: "1F1E7-1F1F7", label: "bandeira: Brasil", unicode: "🇧🇷", group: 9, order: 5014, tags: ["BR", "bandeira"] },
    { hexcode: "1F3FB", label: "tom de pele claro", unicode: "🏻", group: 2, order: 9000, tags: ["pele"] }, // componente: fica fora
    { hexcode: "1F1E6", label: "indicador regional A", unicode: "🇦" }, // sem grupo: fica fora
    DUAS_PESSOAS,
];
const CATEGORIAS = montarCategorias(AMOSTRA);
const emojisDe = (id: string) => CATEGORIAS.find((c) => c.id === id)?.itens.map((i) => i.emoji);

test("categorias: agrupa por grupo, ordena por order e ignora componentes e itens sem grupo", () => {
    assert.deepEqual(CATEGORIAS.map((c) => c.id), ["carinhas", "pessoas", "bandeiras"]);
    assert.deepEqual(emojisDe("carinhas"), ["😀", "💔", "❤️"]);
    assert.deepEqual(emojisDe("pessoas"), ["👍", "🧑‍🤝‍🧑"]); // 354 vem antes de 3124
    assert.equal(CATEGORIAS[0].nome, "Carinhas e emoção");
});

test("busca ignora acento e maiuscula e acha por nome ou palavra-chave", () => {
    assert.equal(normalizarBusca("  CORAÇÃO "), "coracao");
    const achados = buscarEmojis("coracao", CATEGORIAS).map((i) => i.emoji);
    assert.deepEqual([...achados].sort(), ["❤️", "💔"].sort());
    assert.deepEqual(buscarEmojis("decepcao", CATEGORIAS).map((i) => i.emoji), ["💔"]); // so esta nas palavras-chave
    assert.deepEqual(buscarEmojis("BRASIL", CATEGORIAS).map((i) => i.emoji), ["🇧🇷"]);
});

test("busca com mais de uma palavra exige todas; quem tem no nome vem antes", () => {
    assert.deepEqual(buscarEmojis("coração partido", CATEGORIAS).map((i) => i.emoji), ["💔"]);
    const dados: DadoEmoji[] = [
        { hexcode: "A", label: "gato", unicode: "🐱", group: 3, order: 1, tags: ["felino"] },
        { hexcode: "B", label: "felino grande", unicode: "🐯", group: 3, order: 2 },
    ];
    // "felino" so e palavra-chave do gato, mas e nome do tigre: o tigre vem primeiro
    assert.deepEqual(buscarEmojis("felino", montarCategorias(dados)).map((i) => i.emoji), ["🐯", "🐱"]);
});

test("busca vazia ou sem resultado devolve lista vazia e respeita o limite", () => {
    assert.deepEqual(buscarEmojis("", CATEGORIAS), []);
    assert.deepEqual(buscarEmojis("   ", CATEGORIAS), []);
    assert.deepEqual(buscarEmojis("zzzxxqq", CATEGORIAS), []);
    assert.equal(buscarEmojis("a", CATEGORIAS, 2).length, 2);
    assert.ok(LIMITE_BUSCA >= 100);
});

test("tom de pele: so 0 a 5 inteiros valem; o resto vira 0 (amarelo)", () => {
    for (const v of [0, 1, 2, 3, 4, 5]) assert.equal(tomValido(v), true);
    for (const v of [-1, 6, 1.5, Number.NaN, Infinity, "2", null, undefined, {}, [], true]) assert.equal(tomValido(v), false);
    assert.equal(normalizarTom(3), 3);
    assert.equal(normalizarTom(9), 0);
    assert.equal(normalizarTom("1"), 0);
    assert.equal(normalizarTom(null), 0);
});

test("tom de pele: o corpo da rota aceita 0..5 inteiro e recusa o resto", () => {
    for (const v of [0, 1, 5]) assert.equal(esquemaPreferencias.safeParse({ tomDePele: v }).success, true);
    for (const v of [-1, 6, 2.5, "3", null]) assert.equal(esquemaPreferencias.safeParse({ tomDePele: v }).success, false);
    assert.equal(esquemaPreferencias.safeParse({}).success, false); // nada para gravar
    assert.equal(esquemaPreferencias.safeParse(null).success, false);
});

test("tom de pele: variante do tom escolhido; tom 0 e emoji sem tom ficam como estao", () => {
    const polegar = CATEGORIAS[1].itens.find((i) => i.emoji === "👍")!;
    assert.equal(variantePorTom(polegar, 0), "👍");
    assert.equal(variantePorTom(polegar, 1), "👍🏻");
    assert.equal(variantePorTom(polegar, 3), "👍🏽");
    assert.equal(variantePorTom(polegar, 5), "👍🏿");
    const rosto = CATEGORIAS[0].itens[0];
    assert.equal(rosto.tons, null);
    assert.equal(variantePorTom(rosto, 4), "😀");
});

test("tom de pele: em emoji de duas pessoas vale a variante com o mesmo tom nas duas", () => {
    const tons = resolverTons(DUAS_PESSOAS.skins)!;
    assert.equal(tons.length, 5);
    assert.equal(tons[0], "🧑🏻‍🤝‍🧑🏻");
    assert.equal(tons[4], "🧑🏿‍🤝‍🧑🏿");
    assert.equal(resolverTons(undefined), null);
    assert.equal(resolverTons([]), null);
    assert.equal(resolverTons(pele("1F44D-{m}", "👍").slice(0, 3)), null); // incompleto: sem tom
});

test("tom de pele: reacoes rapidas ganham o tom sem a lista completa", () => {
    assert.equal(aplicarTomSimples("👍", 0), "👍");
    assert.equal(aplicarTomSimples("👍", 2), "👍🏼");
    assert.equal(aplicarTomSimples("🙏", 5), "🙏🏿");
    assert.equal(aplicarTomSimples("✌️", 3), "✌🏽"); // tira o seletor de variacao antes do modificador
    assert.equal(aplicarTomSimples("😂", 4), "😂"); // sem tom
    assert.equal(aplicarTomSimples("❤️", 4), "❤️");
});

test("tom de pele: confere com os dados reais (todo emoji com tom acha os 5; reacoes batem com o emojibase)", () => {
    const reais = JSON.parse(readFileSync(join(process.cwd(), "node_modules", "emojibase-data", "pt", "compact.json"), "utf8")) as DadoEmoji[];
    const comTom = reais.filter((d) => d.skins?.length);
    assert.ok(comTom.length > 200);
    for (const d of comTom) assert.ok(resolverTons(d.skins), `${d.hexcode} sem os 5 tons`);
    for (const e of ["👍", "🙏", "👏", "🙌", "👌", "✌️", "🤞", "💪", "🤝"]) {
        const d = reais.find((x) => x.unicode === e || x.unicode === e.replace("️", ""));
        assert.ok(d, `${e} nao esta nos dados`);
        const tons = resolverTons(d.skins)!;
        for (const t of [1, 2, 3, 4, 5] as const) assert.equal(aplicarTomSimples(e, t), tons[t - 1], `${e} no tom ${t}`);
    }
    const todas = montarCategorias(reais);
    assert.equal(todas.length, 9);
    assert.ok(todas.reduce((n, c) => n + c.itens.length, 0) > 1800);
    assert.ok(buscarEmojis("coracao", todas).length > 20);
});

test("linhas da grade: titulo + linhas de N emojis, recentes primeiro, com tom e posicao de cada categoria", () => {
    const { linhas, indices } = montarLinhas(CATEGORIAS, ["🔥", "👍🏽"], 2, 2);
    assert.deepEqual(linhas[0], { tipo: "titulo", id: "recentes", nome: "Recentes" });
    // recentes ja vem com tom: a grade nao mexe neles
    assert.deepEqual(linhas[1], { tipo: "emojis", id: "recentes", itens: [{ emoji: "🔥", rotulo: "" }, { emoji: "👍🏽", rotulo: "" }] });
    assert.equal(indices.recentes, 0);
    assert.equal(linhas[indices.carinhas].tipo, "titulo");
    const pessoas = linhas.slice(indices.pessoas + 1, indices.bandeiras).flatMap((l) => (l.tipo === "emojis" ? l.itens.map((i) => i.emoji) : []));
    assert.deepEqual(pessoas, ["👍🏼", "🧑🏼‍🤝‍🧑🏼"]); // tom 2 aplicado
    const carinhas = linhas.filter((l) => l.tipo === "emojis" && l.id === "carinhas");
    assert.deepEqual(carinhas.map((l) => (l.tipo === "emojis" ? l.itens.length : 0)), [2, 1]); // 3 emojis em linhas de 2
});

test("linhas da grade: sem recentes nao cria a secao", () => {
    const { linhas, indices } = montarLinhas(CATEGORIAS, [], 0, 9);
    assert.equal(indices.recentes, undefined);
    assert.equal(indices.carinhas, 0);
    assert.equal(linhas[0].tipo, "titulo");
});

test("recentes: o mais novo vai para o inicio, sem repetir", () => {
    assert.deepEqual(adicionarRecente(["😀", "😂"], "😂"), ["😂", "😀"]);
    assert.deepEqual(adicionarRecente([], "🔥"), ["🔥"]);
});

test("recentes: guardam o emoji ja com o tom (tons diferentes sao entradas diferentes)", () => {
    assert.deepEqual(adicionarRecente(["👍"], "👍🏽"), ["👍🏽", "👍"]);
    assert.deepEqual(adicionarRecente(["👍🏽", "👍"], "👍🏽"), ["👍🏽", "👍"]);
    const maosDadas = "🧑🏿‍🤝‍🧑🏿";
    assert.deepEqual(adicionarRecente([], maosDadas), [maosDadas]); // sequencia longa com tom cabe
});

test("recentes: no maximo 24", () => {
    let lista: string[] = [];
    for (let i = 0; i < 40; i++) lista = adicionarRecente(lista, String.fromCodePoint(0x1f600 + i));
    assert.equal(lista.length, MAX_RECENTES);
    assert.equal(lista[0], String.fromCodePoint(0x1f600 + 39));
});

test("recentes: texto vazio ou enorme nao entra", () => {
    assert.deepEqual(adicionarRecente(["😀"], ""), ["😀"]);
    assert.deepEqual(adicionarRecente(["😀"], "x".repeat(100)), ["😀"]);
});

test("recentes: ler o que esta guardado aguenta lixo", () => {
    assert.deepEqual(lerRecentes(null), []);
    assert.deepEqual(lerRecentes("isso nao e json"), []);
    assert.deepEqual(lerRecentes('{"a":1}'), []);
    assert.deepEqual(lerRecentes(JSON.stringify(["😀", 5, "", "😀", "😂", null, "y".repeat(80)])), ["😀", "😂"]);
    const muitos = Array.from({ length: 50 }, (_, i) => String.fromCodePoint(0x1f300 + i));
    assert.equal(lerRecentes(JSON.stringify(muitos)).length, MAX_RECENTES);
});

test("recentes: guardar e ler devolve a mesma lista", () => {
    const lista = ["😀", "🇧🇷", "👍🏽"];
    assert.deepEqual(lerRecentes(serializarRecentes(lista)), lista);
});

test("emoji entra na posicao do cursor", () => {
    assert.deepEqual(inserirNoCursor("olá mundo", 3, 3, "😀"), { valor: "olá😀 mundo", cursor: 3 + "😀".length });
});

test("emoji substitui o trecho selecionado", () => {
    assert.deepEqual(inserirNoCursor("abcdef", 2, 4, "🔥"), { valor: "ab🔥ef", cursor: 2 + "🔥".length });
});

test("sem cursor conhecido, o emoji vai para o fim; posicao fora do texto e corrigida", () => {
    assert.deepEqual(inserirNoCursor("oi", null, null, "👍"), { valor: "oi👍", cursor: 2 + "👍".length });
    assert.deepEqual(inserirNoCursor("oi", 99, 120, "👍"), { valor: "oi👍", cursor: 2 + "👍".length });
    assert.deepEqual(inserirNoCursor("", 0, 0, "👍"), { valor: "👍", cursor: "👍".length });
});
