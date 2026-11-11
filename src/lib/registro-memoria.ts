// minha versao: guarda as ultimas linhas que o servidor escreveu no console, para o painel mostrar
// (Manutencao > Logs) mesmo quando o usuario do servico nao pode ler o journal do systemd.
// Fica no globalThis porque o servidor e as rotas do Next tem copias separadas dos modulos.
const MAX_LINHAS = 2000;
const ANSI = /\x1b\[[0-9;]*m/g;

export type LinhaLog = { t: string; nivel: "info" | "aviso" | "erro"; texto: string };
type Estado = { linhas: LinhaLog[]; instalado: boolean };
const G = globalThis as unknown as { __waRegistro?: Estado };
const estado: Estado = (G.__waRegistro ??= { linhas: [], instalado: false });

function texto(args: unknown[]): string {
    return args.map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack || a.message;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ").replace(ANSI, "");
}

/** passa a copiar console.log/info/warn/error para a memoria (uma vez por processo) */
export function instalarRegistroMemoria() {
    if (estado.instalado) return;
    estado.instalado = true;
    const copiar = (nivel: LinhaLog["nivel"], original: (...a: unknown[]) => void) => (...args: unknown[]) => {
        try {
            estado.linhas.push({ t: new Date().toISOString(), nivel, texto: texto(args).slice(0, 4000) });
            if (estado.linhas.length > MAX_LINHAS) estado.linhas.splice(0, estado.linhas.length - MAX_LINHAS);
        } catch { /* o registro nunca derruba o log original */ }
        original(...args);
    };
    console.log = copiar("info", console.log.bind(console));
    console.info = copiar("info", console.info.bind(console));
    console.warn = copiar("aviso", console.warn.bind(console));
    console.error = copiar("erro", console.error.bind(console));
}

export function ultimasLinhas(n = 500): LinhaLog[] {
    return estado.linhas.slice(-Math.max(1, Math.min(n, MAX_LINHAS)));
}
