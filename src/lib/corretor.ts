// minha versao: corretor ortografico OFFLINE (roda so no navegador, nada sai da VM).
// Usa o dicionario VERO pt-BR (public/dicionario/pt.aff + pt.dic) com o motor nspell.
// O dicionario (~4,4 MB) e baixado so na 1a vez que alguem usa o botao "Corrigir" e fica em cache.

export type ErroOrtografico = { palavra: string; inicio: number; fim: number; sugestoes: string[] };

const CHAVE_IGNORAR = "wa-corretor-ignorar"; // palavras que o usuario mandou ignorar (ficam no navegador)

let instancia: Promise<any> | null = null;

function palavrasIgnoradas(): string[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_IGNORAR) || "[]"); } catch { return []; }
}

export function ignorarPalavra(p: string) {
  try {
    const atual = new Set(palavrasIgnoradas());
    atual.add(p.toLowerCase());
    localStorage.setItem(CHAVE_IGNORAR, JSON.stringify([...atual]));
  } catch { /* navegador sem storage */ }
}

// carrega (uma vez) o dicionario + o motor; adiciona as palavras que o usuario mandou ignorar
export function carregarCorretor(): Promise<any> {
  if (!instancia) {
    instancia = (async () => {
      const [aff, dic, mod] = await Promise.all([
        fetch("/dicionario/pt.aff").then((r) => { if (!r.ok) throw new Error("dicionario nao encontrado"); return r.text(); }),
        fetch("/dicionario/pt.dic").then((r) => { if (!r.ok) throw new Error("dicionario nao encontrado"); return r.text(); }),
        import("nspell"),
      ]);
      const nspell = (mod as any).default || mod;
      const spell = nspell({ aff, dic });
      for (const p of palavrasIgnoradas()) { try { spell.add(p); } catch { /* ignora */ } }
      return spell;
    })();
  }
  return instancia;
}

// palavra: letras (com acento), podendo ter hifen/apostrofo no meio
const RE_PALAVRA = /[\p{L}][\p{L}’'’-]*/gu;

// acha os erros de um texto. Ignora numeros, siglas curtas em CAIXA ALTA, @mencao/#tag e links coladinhos.
export function revisar(spell: any, texto: string, limite = 6): ErroOrtografico[] {
  const erros: ErroOrtografico[] = [];
  RE_PALAVRA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_PALAVRA.exec(texto))) {
    const palavra = m[0];
    const inicio = m.index;
    const fim = inicio + palavra.length;
    if (palavra.length < 2) continue;
    if (/\d/.test(palavra)) continue;                                   // tem numero (ex.: 3g, h1)
    if (palavra === palavra.toUpperCase() && palavra.length <= 5) continue; // sigla (ONG, CPF, RG)
    const antes = texto[inicio - 1];
    if (antes === "@" || antes === "#" || antes === "/" || antes === ".") continue; // mencao/tag/link
    const depois = texto[fim];
    if (depois === "@") continue;                                       // e-mail coladinho
    try {
      if (spell.correct(palavra)) continue;
    } catch { continue; }
    let sugestoes: string[] = [];
    try { sugestoes = (spell.suggest(palavra) || []).slice(0, limite); } catch { sugestoes = []; }
    erros.push({ palavra, inicio, fim, sugestoes });
  }
  return erros;
}

// troca a ocorrencia em [inicio,fim) do texto pela sugestao, preservando a Capitalizacao inicial
export function aplicarSugestao(texto: string, inicio: number, fim: number, sugestao: string): string {
  const original = texto.slice(inicio, fim);
  let nova = sugestao;
  if (original[0] && original[0] === original[0].toUpperCase() && nova[0]) {
    nova = nova[0].toUpperCase() + nova.slice(1);
  }
  return texto.slice(0, inicio) + nova + texto.slice(fim);
}
