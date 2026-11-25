// minha versao: "npm audit --audit-level=high" com uma lista curta de excecoes, cada uma com motivo e prazo.
// Uso no CI (.github/workflows/verificacao.yml):
//   npm audit --json > npm-audit.json || true
//   node scripts/auditoria-dependencias.mjs
// (o script nao chama processos: so le o relatorio). Reprova se:
//  - o relatorio nao existir ou nao for JSON valido (ex.: npm audit sem rede);
//  - houver alerta alto ou critico que nao esteja na lista;
//  - uma excecao estiver vencida (obriga a rever: o alerta pode ja ter correcao).
// Excecoes em .github/auditoria-excecoes.json: [{ "id": "GHSA-...", "pacote": "...", "motivo": "...", "ate": "AAAA-MM-DD" }]
import { readFileSync } from "node:fs";

const NIVEIS = new Set(["high", "critical"]);
const ARQ_EXCECOES = new URL("../.github/auditoria-excecoes.json", import.meta.url);
// caminho fixo (nao vem da linha de comando): o CI grava o relatorio na raiz do projeto
const ARQ_RELATORIO = new URL("../npm-audit.json", import.meta.url);

function lerExcecoes() {
    const lista = JSON.parse(readFileSync(ARQ_EXCECOES, "utf8"));
    if (!Array.isArray(lista)) throw new Error("auditoria-excecoes.json precisa ser uma lista");
    for (const e of lista) {
        if (!/^GHSA-[\w-]+$/.test(e?.id || "") || !e.pacote || !e.motivo || !/^\d{4}-\d{2}-\d{2}$/.test(e.ate || "")) {
            throw new Error(`excecao invalida: ${JSON.stringify(e)} (precisa de id GHSA, motivo e ate AAAA-MM-DD)`);
        }
    }
    return lista;
}

function lerRelatorio() {
    let bruto;
    try {
        bruto = readFileSync(ARQ_RELATORIO, "utf8");
    } catch {
        throw new Error("npm-audit.json nao encontrado; gere com: npm audit --json > npm-audit.json");
    }
    const saida = bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto; // tira o BOM
    let rel;
    try {
        rel = JSON.parse(saida);
    } catch {
        throw new Error(`relatorio do npm audit nao e JSON: ${saida.slice(0, 300)}`);
    }
    if (rel?.error) throw new Error(`npm audit falhou: ${JSON.stringify(rel.error).slice(0, 300)}`);
    // revisao de seguranca: so aceita o formato completo do npm audit (versao 2, com metadata);
    // qualquer outra coisa (registro fora do ar, erro de rede) reprova em vez de passar como "sem alertas"
    if (rel?.auditReportVersion !== 2) throw new Error(`formato inesperado do npm audit (auditReportVersion=${rel?.auditReportVersion})`);
    if (!rel.vulnerabilities || typeof rel.vulnerabilities !== "object") throw new Error("relatorio sem o campo vulnerabilities");
    const meta = rel.metadata?.vulnerabilities;
    if (!meta || typeof meta.high !== "number" || typeof meta.critical !== "number") throw new Error("relatorio sem metadata.vulnerabilities");
    return rel;
}

function alertasAltos(relatorio) {
    const achados = new Map(); // id -> { id, titulo, pacotes:Set }
    for (const [pacote, v] of Object.entries(relatorio.vulnerabilities || {})) {
        for (const via of v.via || []) {
            if (typeof via !== "object" || !NIVEIS.has(via.severity)) continue;
            const id = String(via.url || "").split("/").pop() || `fonte-${via.source}`;
            const a = achados.get(id) || { id, titulo: via.title, pacotes: new Set(), critico: false };
            a.pacotes.add(pacote);
            if (via.severity === "critical") a.critico = true;
            achados.set(id, a);
        }
    }
    return [...achados.values()];
}

function main() {
    const hoje = new Date().toISOString().slice(0, 10);
    const excecoes = lerExcecoes();
    const vencidas = excecoes.filter((e) => e.ate < hoje);
    const validas = new Map(excecoes.filter((e) => e.ate >= hoje).map((e) => [e.id, e]));

    const relatorio = lerRelatorio();
    const altos = alertasAltos(relatorio);
    const meta = relatorio.metadata.vulnerabilities;
    if (meta.high + meta.critical > 0 && altos.length === 0) {
        console.error("Reprovado: o npm audit conta alertas altos/criticos mas nenhum foi identificado no relatorio.");
        process.exit(1);
    }
    // a excecao vale so para o mesmo alerta, no mesmo pacote, e deixa de valer se ele virar critico
    const coberto = (a) => {
        const e = validas.get(a.id);
        return Boolean(e && !a.critico && a.pacotes.has(e.pacote) && a.pacotes.size === 1);
    };
    const aceitos = altos.filter(coberto);
    const barrados = altos.filter((a) => !coberto(a));

    for (const a of aceitos) {
        const e = validas.get(a.id);
        console.log(`ACEITO ate ${e.ate}: ${a.id} (${[...a.pacotes].join(", ")}) - ${e.motivo}`);
    }
    for (const e of vencidas) console.error(`EXCECAO VENCIDA em ${e.ate}: ${e.id}. Reveja: atualize o pacote ou renove com novo motivo.`);
    for (const a of barrados) console.error(`ALERTA ${a.id}: ${a.titulo} (${[...a.pacotes].join(", ")})`);

    if (vencidas.length || barrados.length) {
        console.error(`Reprovado: ${barrados.length} alerta(s) alto(s)/critico(s) sem excecao, ${vencidas.length} excecao(oes) vencida(s).`);
        process.exit(1);
    }
    console.log(`OK: nenhum alerta alto ou critico fora das excecoes (${aceitos.length} aceito(s)).`);
}

try {
    main();
} catch (e) {
    console.error(`Falha na auditoria de dependencias: ${e.message}`);
    process.exit(1);
}
