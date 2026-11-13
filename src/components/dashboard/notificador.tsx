"use client";

// minha versao: notificacao de mensagem nova estilo "Dynamic Island".
//  - aba do painel visivel: ilha preta no topo da pagina (expande, mostra quem mandou e o texto, some sozinha);
//  - aba escondida / outra aba / outro programa: notificacao nativa do sistema + contador "(3)" no titulo;
//  - "ilha flutuante": no Chrome/Edge usa Picture-in-Picture (fica por cima de TUDO); nos outros navegadores
//    cai num window.open (janela separada) — funciona em qualquer navegador;
//  - som de recebida (src/lib/sons.ts). Com varias abas do painel abertas, so uma toca/notifica.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, Users, X } from "lucide-react";
import { useSocket } from "@/components/chat/socket-context";
import { useSession as useWaSession } from "@/components/dashboard/session-provider";
import { EVENTO_ALERTAS, desbloquearAudio, lerAlertas, tocarRecebida, type Alertas } from "@/lib/sons";
import { EVENTO_ABRIR_CHAT, jidDaUrl, urlDoJid } from "@/lib/jid-url";

export const EVENTO_ILHA_FLUTUANTE = "wa-ilha-flutuante";
export const EVENTO_TESTAR_ALERTA = "wa-testar-alerta";

type Item = {
    id: string;
    sessionId: string; // sessionId "texto" (o da URL/cookie)
    jid: string;
    titulo: string;
    autor?: string; // em grupo: quem falou
    autorJid?: string | null;
    sessaoNome?: string; // com mais de uma sessao: de qual WhatsApp veio
    texto: string;
    quando: number;
    foto?: string | null;      // foto do contato (ou do grupo)
    fotoAutor?: string | null; // em grupo: foto de quem falou (no canto)
};

// fotos de perfil buscadas pela rota do proprio painel (cache por sessao+jid, inclusive "sem foto")
const fotoCache = new Map<string, string | null>();
async function fotoDe(sessionId: string, jid?: string | null, esperaMs = 1800): Promise<string | null> {
    if (!jid || jid.startsWith("teste")) return null;
    const k = `${sessionId}|${jid}`;
    if (fotoCache.has(k)) return fotoCache.get(k)!;
    const busca = fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/profile-picture`, { method: "POST" })
        .then((r) => r.json())
        .then((d) => {
            const url: string | null = d?.profilePicUrl || null;
            fotoCache.set(k, url);
            if (url) { const img = new Image(); img.src = url; } // ja deixa carregada
            return url;
        })
        .catch(() => null);
    // nao segura o pop-up por muito tempo esperando a foto
    return Promise.race([busca, new Promise<null>((r) => setTimeout(() => r(null), esperaMs))]);
}

// nome (e foto) do grupo direto do WhatsApp quando o banco ainda nao tem o "subject"
const grupoCache = new Map<string, { nome: string | null; foto: string | null }>();
async function grupoDe(sessionId: string, jid: string, esperaMs = 2000) {
    const k = `${sessionId}|${jid}`;
    if (grupoCache.has(k)) return grupoCache.get(k)!;
    const busca = fetch(`/api/groups/${sessionId}/${encodeURIComponent(jid)}`)
        .then((r) => r.json())
        .then((d) => {
            const v = { nome: (d?.subject as string) || null, foto: (d?.pictureUrl as string) || null };
            if (v.nome) grupoCache.set(k, v);
            if (v.foto) fotoCache.set(k, v.foto);
            return v;
        })
        .catch(() => ({ nome: null, foto: null }));
    return Promise.race([busca, new Promise<{ nome: null; foto: null }>((r) => setTimeout(() => r({ nome: null, foto: null }), esperaMs))]);
}

const DURACAO_MS = 7000; // tempo na tela (conta so com a pagina visivel; nunca menos de 5 s)

const ROTULO: Record<string, string> = {
    IMAGE: "📷 Foto", VIDEO: "🎥 Vídeo", AUDIO: "🎤 Áudio", DOCUMENT: "📄 Documento",
    STICKER: "🌟 Figurinha", LOCATION: "📍 Localização", CONTACT: "👤 Contato",
};

function textoDa(m: any): string {
    const c = String(m.content || "").replace(/\s+/g, " ").trim();
    if (m.type && m.type !== "TEXT") {
        const r = ROTULO[m.type] || "📎 Anexo";
        return c && m.type !== "LOCATION" ? `${r.split(" ")[0]} ${c}` : r;
    }
    return c || "Mensagem";
}

function telefone(jid?: string | null) {
    if (!jid || !jid.endsWith("@s.whatsapp.net")) return "";
    const d = jid.split("@")[0];
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
        const ddd = d.slice(2, 4), n = d.slice(4);
        return `(${ddd}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
    }
    return "+" + d;
}

function iniciais(s: string) {
    const p = s.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

// Com varias abas do painel abertas: a aba visivel ganha na hora; as escondidas disputam com atraso
function reivindicar(chave: string, visivel: boolean): Promise<boolean> {
    return new Promise((resolve) => {
        const k = "wa-n:" + chave;
        const tentar = () => {
            try {
                if (!visivel && localStorage.getItem(k)) return resolve(false);
                localStorage.setItem(k, String(Date.now()));
            } catch { /* sem storage: notifica assim mesmo */ }
            resolve(true);
        };
        if (visivel) tentar(); else setTimeout(tentar, 150 + Math.random() * 250);
    });
}

function limparReivindicacoes() {
    try {
        const limite = Date.now() - 10 * 60_000;
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith("wa-n:") && Number(localStorage.getItem(k)) < limite) localStorage.removeItem(k);
        }
    } catch { /* ignora */ }
}

const TITULO_RE = /^\(\d+\)\s+/;

export function Notificador() {
    const { getSocket } = useSocket();
    const { sessions, sessionId: sessaoAtual, setSessionId } = useWaSession();
    const router = useRouter();
    const pathname = usePathname();

    const [itens, setItens] = useState<Item[]>([]);
    const itensRef = useRef<Item[]>([]);
    itensRef.current = itens;
    const [aberta, setAberta] = useState(false); // ilha expandida
    const [pip, setPip] = useState<Window | null>(null);
    const alertasRef = useRef<Alertas>(lerAlertas());
    const naoLidasRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pausadoRef = useRef(false);
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const pathRef = useRef(pathname);
    pathRef.current = pathname;

    // preferencias e audio
    useEffect(() => {
        desbloquearAudio();
        const h = (e: Event) => { alertasRef.current = (e as CustomEvent).detail || lerAlertas(); };
        window.addEventListener(EVENTO_ALERTAS, h);
        limparReivindicacoes();
        // pede permissao de notificacao no primeiro clique (o navegador exige um gesto)
        const pedir = () => {
            try {
                if ("Notification" in window && Notification.permission === "default" && lerAlertas().notifSistema) Notification.requestPermission().catch(() => {});
            } catch { /* ignora */ }
        };
        window.addEventListener("pointerdown", pedir, { once: true });
        return () => { window.removeEventListener(EVENTO_ALERTAS, h); window.removeEventListener("pointerdown", pedir); };
    }, []);

    // contador "(n)" no titulo da aba enquanto ela nao esta visivel
    const atualizarTitulo = useCallback(() => {
        const base = document.title.replace(TITULO_RE, "");
        document.title = naoLidasRef.current > 0 ? `(${naoLidasRef.current}) ${base}` : base;
    }, []);
    useEffect(() => {
        const zerar = () => {
            if (document.visibilityState === "visible" && document.hasFocus()) { naoLidasRef.current = 0; atualizarTitulo(); }
        };
        document.addEventListener("visibilitychange", zerar);
        window.addEventListener("focus", zerar);
        return () => { document.removeEventListener("visibilitychange", zerar); window.removeEventListener("focus", zerar); };
    }, [atualizarTitulo]);

    // fecha depois de DURACAO_MS; com o mouse em cima ou a aba escondida, espera (a pessoa precisa ver)
    const agendarFechar = useCallback((ms: number = DURACAO_MS) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            if (pausadoRef.current || document.visibilityState !== "visible") return agendarFechar(5000);
            setAberta(false);
            setTimeout(() => setItens((l) => (l.length && !pausadoRef.current ? [] : l)), 450);
        }, Math.max(ms, 5000));
    }, []);
    // voltou para a aba com a ilha aberta: garante mais 5 s na tela
    useEffect(() => {
        const h = () => { if (document.visibilityState === "visible" && itensRef.current.length) agendarFechar(5000); };
        document.addEventListener("visibilitychange", h);
        return () => document.removeEventListener("visibilitychange", h);
    }, [agendarFechar]);

    const abrirConversa = useCallback((it: Item) => {
        setAberta(false);
        setItens([]);
        try { window.focus(); } catch { /* ignora */ }
        const destino = `/dashboard/chat/${urlDoJid(it.jid)}`;
        if (it.sessionId !== sessaoAtual) {
            setSessionId(it.sessionId, destino); // troca e abre a conversa certa desta sessao
            return;
        }
        // ja na tela de conversas: troca a conversa na hora; senao (ou se ninguem atendeu) navega
        const detail = { sessionId: it.sessionId, jid: it.jid, name: it.titulo, handled: false };
        window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT, { detail }));
        if (!detail.handled) router.push(destino);
    }, [router, sessaoAtual, setSessionId]);
    const abrirRef = useRef(abrirConversa);
    abrirRef.current = abrirConversa;

    const notificar = useCallback(async (it: Item, chaveDedup: string) => {
        const a = alertasRef.current;
        const visivel = document.visibilityState === "visible";
        const focada = visivel && document.hasFocus();
        if (!(await reivindicar(chaveDedup, visivel))) return;

        // conversa ja aberta na tela e com foco: so o som (igual WhatsApp Web)
        const atual = (pathRef.current || "").startsWith("/dashboard/chat/") ? jidDaUrl(pathRef.current!.replace("/dashboard/chat/", "")) : "";
        const mesmaConversa = focada && atual === it.jid;

        tocarRecebida();
        if (!focada) { naoLidasRef.current++; atualizarTitulo(); }

        // icone: foto do contato (em grupo, a do grupo + a de quem falou no canto)
        const ehGrupo = it.jid.endsWith("@g.us");
        const semNomeGrupo = ehGrupo && (!it.titulo || it.titulo === "Grupo");
        const [foto, fotoAutor, g] = await Promise.all([
            semNomeGrupo ? Promise.resolve(null) : fotoDe(it.sessionId, it.jid),
            ehGrupo ? fotoDe(it.sessionId, it.autorJid) : Promise.resolve(null),
            semNomeGrupo ? grupoDe(it.sessionId, it.jid) : Promise.resolve(null),
        ]);
        it = { ...it, foto: foto || g?.foto || null, fotoAutor, titulo: g?.nome || it.titulo };

        if (a.popup && !mesmaConversa) {
            setItens((l) => [it, ...l.filter((x) => x.jid !== it.jid)].slice(0, 5));
            setAberta(true);
            agendarFechar();
        }

        // fora do painel (outra aba / outro programa / minimizado): notificacao do sistema
        if (!focada && a.notifSistema && "Notification" in window && Notification.permission === "granted") {
            try {
                // grupo: titulo = nome do grupo; corpo = quem falou e a mensagem embaixo
                const n = new Notification((it.autor ? `👥 ${it.titulo}` : it.titulo) + (it.sessaoNome ? ` [${it.sessaoNome}]` : ""), {
                    body: it.autor ? `${it.autor}\n${it.texto}` : it.texto,
                    tag: `wa-${it.jid}`, // a mesma conversa substitui a anterior
                    icon: it.foto || "/favicon.ico",
                    silent: a.somRecebida, // ja tocamos o nosso som
                });
                n.onclick = () => { try { window.focus(); } catch { /* ignora */ } abrirRef.current(it); n.close(); };
                setTimeout(() => n.close(), 15_000);
            } catch { /* alguns navegadores so permitem via service worker */ }
        }
    }, [agendarFechar, atualizarTitulo]);

    // entra nas salas de TODAS as sessoes do usuario e escuta mensagens novas
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const entrar = () => sessionsRef.current.forEach((s) => socket.emit("join-session", s.sessionId));
        if (socket.connected) entrar();
        socket.on("connect", entrar);

        const handler = (msgs: any[]) => {
            if (!Array.isArray(msgs)) return;
            for (const m of msgs) {
                if (!m?.live || m.fromMe) continue;
                // minha versao: conversa silenciada (no painel ou no celular) nao toca nem notifica, como no WhatsApp
                if (m.silenciada) continue;
                const jid: string = m.remoteJid || "";
                if (!jid || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;
                const sess = sessionsRef.current.find((s) => s.sessionId === m.sessionKey) || sessionsRef.current.find((s) => s.id === m.sessionId);
                if (!sess) continue;
                const grupo = jid.endsWith("@g.us");
                const pessoa = m.senderName || m.pushName || telefone(m.senderJid) || (grupo ? "Membro" : "");
                const titulo = grupo ? (m.chatName || "Grupo") : (m.chatName || m.pushName || telefone(jid) || "Contato");
                notificar({
                    id: m.keyId || String(Math.random()),
                    sessionId: sess.sessionId,
                    jid,
                    titulo,
                    autor: grupo ? pessoa : undefined,
                    autorJid: grupo ? m.senderJid : null,
                    sessaoNome: sessionsRef.current.length > 1 ? sess.name : undefined,
                    texto: textoDa(m),
                    quando: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
                }, `${sess.sessionId}:${m.keyId}`);
            }
        };
        socket.on("message.update", handler);
        return () => { socket.off("connect", entrar); socket.off("message.update", handler); };
    }, [getSocket, sessions, notificar]);

    // ---- ilha flutuante (Document Picture-in-Picture: janela pequena sempre por cima) ----
    const abrirFlutuante = useCallback(async () => {
        if (pip) { try { pip.focus(); } catch { /* ignora */ } return; }

        // prepara a janelinha (vale pro PiP e pro window.open): leva o CSS/tema e o fundo do tema
        const prepara = (w: Window) => {
            try {
                document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => w.document.head.appendChild(n.cloneNode(true)));
                w.document.documentElement.className = document.documentElement.className;
                w.document.title = "WA · Notificações";
                w.document.body.style.margin = "0";
                w.document.body.style.background = "var(--card)";
                w.addEventListener("pagehide", () => setPip(null));
            } catch { /* ignora */ }
            setPip(w);
        };

        // 1) Chrome/Edge: Document Picture-in-Picture (janela pequena SEMPRE por cima de tudo)
        const dpip = (window as any).documentPictureInPicture;
        if (dpip?.requestWindow) {
            try {
                const w: Window = await dpip.requestWindow({ width: 380, height: 150 });
                prepara(w);
                return;
            } catch (e) { console.warn("PiP falhou, tentando janela comum", e); }
        }

        // 2) Firefox/Safari/outros: janela pequena comum (nao fica "sempre por cima", mas e separada e funciona em todos)
        const w = window.open("", "wa-ilha-flutuante", "width=400,height=170,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes");
        if (!w) { alert("Para a ilha flutuante, permita pop-ups deste site e clique de novo."); return; }
        try {
            w.document.open();
            w.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"></head><body></body></html>`);
            w.document.close();
        } catch { /* ignora */ }
        prepara(w);
        // o window.open nem sempre dispara pagehide: vigia se o usuario fechou a janela
        const vigia = setInterval(() => { if (w.closed) { clearInterval(vigia); setPip(null); } }, 1000);
    }, [pip]);
    useEffect(() => {
        const h = () => { abrirFlutuante(); };
        const t = () => {
            tocarRecebida(true);
            notificar({ id: "teste", sessionId: sessaoAtual, jid: "teste@s.whatsapp.net", titulo: "Teste de alerta", autor: undefined, texto: "Assim aparece uma mensagem nova 👋", quando: Date.now() }, "teste:" + Date.now());
        };
        window.addEventListener(EVENTO_ILHA_FLUTUANTE, h);
        window.addEventListener(EVENTO_TESTAR_ALERTA, t);
        return () => { window.removeEventListener(EVENTO_ILHA_FLUTUANTE, h); window.removeEventListener(EVENTO_TESTAR_ALERTA, t); };
    }, [abrirFlutuante, notificar, sessaoAtual]);

    const principal = itens[0];
    const extras = itens.length - 1;

    const onClicar = (it: Item) => { if (it.id !== "teste") abrirConversa(it); else { setAberta(false); setItens([]); } };

    return (
        <>
            {/* ilha dentro da pagina */}
            <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-3">
                <div
                    onMouseEnter={() => { pausadoRef.current = true; }}
                    onMouseLeave={() => { pausadoRef.current = false; agendarFechar(); }}
                    className={
                        "overflow-hidden bg-card text-card-foreground shadow-2xl ring-1 ring-border " +
                        "transition-[width,max-height,border-radius,opacity,transform] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] " +
                        (principal && aberta
                            ? "pointer-events-auto w-[min(420px,calc(100vw-24px))] max-h-44 rounded-[28px] opacity-100 translate-y-0 hover:scale-[1.02]"
                            : "pointer-events-none w-32 max-h-8 rounded-full opacity-0 -translate-y-3")
                    }
                >
                    {principal && <CartaoIlha it={principal} extras={extras} onClick={() => onClicar(principal)} onFechar={() => { setAberta(false); setItens([]); }} />}
                </div>
            </div>

            {/* ilha flutuante (janela PiP) */}
            {pip && createPortal(
                <div className="h-screen w-screen bg-card text-card-foreground flex items-center px-2">
                    {principal ? (
                        <div className="w-full rounded-[24px] bg-card ring-1 ring-border">
                            <CartaoIlha it={principal} extras={extras} onClick={() => onClicar(principal)} onFechar={() => setItens([])} />
                        </div>
                    ) : (
                        <div className="w-full flex items-center justify-center gap-2 text-muted-foreground text-sm">
                            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                            Aguardando mensagens…
                        </div>
                    )}
                </div>,
                pip.document.body
            )}
        </>
    );
}

function Bolinha({ foto, nome, className }: { foto?: string | null; nome: string; className: string }) {
    const [erro, setErro] = useState(false);
    if (foto && !erro) {
        return <img src={foto} alt="" referrerPolicy="no-referrer" onError={() => setErro(true)} className={`${className} rounded-full object-cover`} />;
    }
    return (
        <div className={`${className} rounded-full bg-primary flex items-center justify-center font-bold text-primary-foreground`}>
            {iniciais(nome)}
        </div>
    );
}

function CartaoIlha({ it, extras, onClick, onFechar }: { it: Item; extras: number; onClick: () => void; onFechar: () => void }) {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none" onClick={onClick} title="Abrir conversa">
            <div className="relative shrink-0">
                <Bolinha foto={it.foto} nome={it.titulo} className="h-11 w-11 text-sm" />
                {it.autor ? (
                    // grupo: foto (ou iniciais) de quem falou no canto
                    <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
                        <Bolinha foto={it.fotoAutor} nome={it.autor} className="h-5 w-5 text-[8px]" />
                    </span>
                ) : (
                    <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-card flex items-center justify-center">
                        <MessageCircle className="h-3.5 w-3.5 text-primary" />
                    </span>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-semibold">
                        {it.autor && <Users className="inline h-3.5 w-3.5 mr-1 -mt-0.5 text-primary" />}
                        {it.titulo}
                    </span>
                    {it.sessaoNome && (
                        <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-foreground" title="Sessão do WhatsApp">
                            {it.sessaoNome}
                        </span>
                    )}
                    <span className={`${it.sessaoNome ? "" : "ml-auto "}shrink-0 text-[10px] text-muted-foreground`}>
                        {new Date(it.quando).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                </div>
                {it.autor && <p className="truncate text-[12px] font-semibold leading-snug text-foreground">{it.autor}</p>}
                <p className="line-clamp-2 text-[12.5px] leading-snug text-foreground/80">{it.texto}</p>
                {extras > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">+{extras} outra{extras > 1 ? "s" : ""} conversa{extras > 1 ? "s" : ""}</p>}
            </div>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFechar(); }}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Dispensar"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
