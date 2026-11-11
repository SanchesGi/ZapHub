// minha versao: sons de mensagem recebida/enviada gerados no proprio navegador (WebAudio, sem arquivo)
// e as preferencias de alerta (guardadas no localStorage de cada navegador).

export type Alertas = {
    somRecebida: boolean;
    somEnviada: boolean;
    popup: boolean;        // ilha no topo da pagina
    notifSistema: boolean; // notificacao do Windows quando a aba nao esta visivel
    assinar: boolean;      // conversa privada: "*Nome*" em cima da mensagem enviada
    assinarGrupo: boolean; // grupo: idem (ligado por padrao)
    volume: number;        // 0..1
};

const CHAVE = "wa-alertas";
const PADRAO: Alertas = { somRecebida: true, somEnviada: true, popup: true, notifSistema: true, assinar: false, assinarGrupo: true, volume: 0.6 };
export const EVENTO_ALERTAS = "wa-alertas-mudou";

export function lerAlertas(): Alertas {
    try {
        const raw = localStorage.getItem(CHAVE);
        if (raw) return { ...PADRAO, ...JSON.parse(raw) };
    } catch { /* storage indisponivel */ }
    return { ...PADRAO };
}

export function salvarAlertas(parcial: Partial<Alertas>): Alertas {
    const novo = { ...lerAlertas(), ...parcial };
    try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch { /* ignora */ }
    try { window.dispatchEvent(new CustomEvent(EVENTO_ALERTAS, { detail: novo })); } catch { /* ignora */ }
    return novo;
}

let ctx: AudioContext | null = null;

function contexto(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        if (!ctx) {
            const AC = window.AudioContext || (window as any).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        return ctx;
    } catch { return null; }
}

// O navegador so libera audio depois de um clique/tecla na pagina
export function desbloquearAudio() {
    const liberar = () => { contexto(); };
    window.addEventListener("pointerdown", liberar, { once: true, capture: true });
    window.addEventListener("keydown", liberar, { once: true, capture: true });
}

function nota(c: AudioContext, freq: number, inicio: number, dur: number, vol: number, tipo: OscillatorType = "sine") {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, inicio);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), inicio + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    o.connect(g).connect(c.destination);
    o.start(inicio);
    o.stop(inicio + dur + 0.02);
}

let ultimoRecebida = 0;

// "ding-dong" subindo: chegou mensagem
export function tocarRecebida(forcar = false) {
    const a = lerAlertas();
    if (!forcar && !a.somRecebida) return;
    const agora = Date.now();
    if (!forcar && agora - ultimoRecebida < 700) return; // rajada de mensagens = 1 som
    ultimoRecebida = agora;
    const c = contexto();
    if (!c) return;
    const t = c.currentTime + 0.01;
    const v = 0.35 * a.volume;
    nota(c, 880, t, 0.18, v);
    nota(c, 1318.5, t + 0.11, 0.32, v);
}

// "whoosh" curto descendo: mensagem enviada
export function tocarEnviada(forcar = false) {
    const a = lerAlertas();
    if (!forcar && !a.somEnviada) return;
    const c = contexto();
    if (!c) return;
    const t = c.currentTime + 0.01;
    const v = 0.22 * a.volume;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.22);
}
