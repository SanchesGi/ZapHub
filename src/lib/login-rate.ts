// minha versao: trava temporaria contra forca-bruta no login.
// 5 erros em 15 min bloqueiam aquele e-mail por 15 min (mesmo com a senha certa), freando tentativas automaticas.
type Reg = { fails: number; prim: number; until: number };
const mapa: Map<string, Reg> = ((globalThis as any).__waLoginRate ??= new Map<string, Reg>());

const MAX = 5;
const JANELA = 15 * 60_000;   // conta erros dentro de 15 min
const BLOQUEIO = 15 * 60_000; // bloqueio de 15 min

export function estaBloqueado(chave: string): number {
    const r = mapa.get(chave.toLowerCase());
    if (r && r.until > Date.now()) return Math.ceil((r.until - Date.now()) / 60_000); // minutos restantes
    return 0;
}

export function registrarFalha(chave: string): void {
    const k = chave.toLowerCase();
    const agora = Date.now();
    let r = mapa.get(k);
    if (!r || agora - r.prim > JANELA) r = { fails: 0, prim: agora, until: 0 };
    r.fails++;
    if (r.fails >= MAX) { r.until = agora + BLOQUEIO; r.fails = 0; r.prim = agora; }
    mapa.set(k, r);
    // limpeza leve para o mapa nao crescer sem fim
    if (mapa.size > 500) for (const [kk, vv] of mapa) if (vv.until < agora && agora - vv.prim > JANELA) mapa.delete(kk);
}

// minha versao: o login em 2 etapas chama o precheck e depois o login com a mesma senha. A falha do precheck ja
// conta no bloqueio; o login que vem logo em seguida (ate 60 s) nao conta de novo, para nao bloquear com 3 erros.
const doPrecheck: Map<string, number> = ((globalThis as any).__waLoginPrecheck ??= new Map<string, number>());
const VALE_PRECHECK_MS = 60_000;

/** falha de senha vista pelo precheck: conta no mesmo bloqueio do login */
export function registrarFalhaPrecheck(chave: string, agora = Date.now()): void {
    registrarFalha(chave);
    doPrecheck.set(chave.toLowerCase(), agora + VALE_PRECHECK_MS);
    if (doPrecheck.size > 500) for (const [k, ate] of doPrecheck) if (ate < agora) doPrecheck.delete(k);
}

/** falha de senha no login: nao conta de novo se o precheck acabou de contar a mesma tentativa */
export function registrarFalhaLogin(chave: string, agora = Date.now()): void {
    const k = chave.toLowerCase();
    const ate = doPrecheck.get(k);
    if (ate !== undefined) {
        doPrecheck.delete(k);
        if (ate >= agora) return;
    }
    registrarFalha(chave);
}

export function limparFalhas(chave: string): void {
    mapa.delete(chave.toLowerCase());
    doPrecheck.delete(chave.toLowerCase());
}
