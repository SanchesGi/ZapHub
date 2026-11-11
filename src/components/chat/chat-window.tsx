"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, ArrowLeft, FileText, Image as ImageIcon, Music, Video, Download, ArrowDown, CornerUpLeft, Copy, Trash2, Info, X, Sparkles, Sticker, PenLine, Search } from "lucide-react";
import { EVENTO_ALERTAS, lerAlertas, salvarAlertas, tocarEnviada } from "@/lib/sons";
import { BookUser, UserPlus, MessageCircle, SmilePlus, Plus, Pin, PinOff, RefreshCw, ImageOff, ChevronLeft, Forward } from "lucide-react";
import { Tiques } from "./chat-list";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { salvarContato, NovaConversaDialog } from "./nova-conversa";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CorretorTexto } from "@/components/ui/corretor-texto";
import { EVENTO_ARQUIVOS_PENDENTES, pegarArquivos, temArquivos } from "@/lib/arquivos-pendentes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { nomeParaDownload } from "@/lib/nome-download";
import { toast } from "sonner";
import { getChatMessages, sendChatMessage, sendMediaMessage, reagirMensagem, marcarConversaLida, getEstadoConversa, fixarMensagem, tentarBaixarMidia, buscarNaConversa, pularParaMensagem } from "@/app/dashboard/chat/actions";
import { exigirSucesso } from "@/lib/resultado-acao";
import { useSocket } from "./socket-context";
import { InteractiveMessageDialog } from "./interactive-message-dialog";
import { GravadorVoz } from "./gravador-voz";
import { ReprodutorAudio } from "./reprodutor-audio";
import { ReprodutorVideo } from "./reprodutor-video"; // minha versao: player de video proprio
import { TextoComLinks, PreviaLinkCartao, type PreviaLink } from "./texto-com-links"; // minha versao: links clicaveis + previa
import { VisualizadorImagem } from "./visualizador-imagem"; // minha versao: zoom nas fotos
import { EncaminharDialog } from "./encaminhar-dialog"; // minha versao: encaminhar mensagem
import { ChatInfoPanel, formatarTelefone, type Participante } from "./chat-info-panel";
import { useTranslations } from "next-intl";

interface Message {
    id: string;
    keyId: string;
    content: string;
    fromMe: boolean;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    senderJid?: string | null;
    senderName?: string | null;
    mediaUrl?: string;
    remoteJid?: string;
    quoteId?: string | null;
    sentBy?: string | null; // minha versao: atendente do painel que enviou
    origemEnvio?: "PLATAFORMA" | "FORA" | null; // minha versao: saiu pela plataforma ou fora dela (celular)
    extra?: { contatos?: ContatoVcard[]; midiaPendente?: { falhou?: boolean } | null; previa?: PreviaLink | null; encaminhada?: { vezes: number } | null } | null; // minha versao: contatos encaminhados (vCard), midia ainda baixando e previa de link
    reacoes?: Record<string, { e: string; n?: string | null }> | null; // minha versao: reacoes ("eu" = este numero)
    quoted?: {
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
        senderName?: string | null;
        sentBy?: string | null;
        type?: string;
    } | null;
}

// minha versao: miniatura na previa de envio (imagem/video mostram o conteudo; o resto, icone + nome + tamanho)
function MiniaturaArquivo({ arquivo, onRemover }: { arquivo: File; onRemover?: () => void }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!arquivo.type.startsWith("image/") && !arquivo.type.startsWith("video/")) return;
        const u = URL.createObjectURL(arquivo);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [arquivo]);
    const mb = arquivo.size / (1024 * 1024);
    const Icone = arquivo.type.startsWith("audio/") ? Music : arquivo.type.startsWith("video/") ? Video : FileText;
    return (
        <div className="relative rounded-lg border border-border/60 bg-muted/40 overflow-hidden aspect-square flex items-center justify-center">
            {url && arquivo.type.startsWith("image/") ? (
                <img src={url} alt={arquivo.name} className="h-full w-full object-cover" />
            ) : url && arquivo.type.startsWith("video/") ? (
                <video src={url} className="h-full w-full object-cover" muted />
            ) : (
                <div className="flex flex-col items-center gap-1 p-2 text-center">
                    <Icone className="h-7 w-7 text-primary" />
                    <span className="text-[10px] leading-tight break-all line-clamp-3">{arquivo.name}</span>
                </div>
            )}
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">{mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(arquivo.size / 1024))} KB`}</span>
            {onRemover && (
                <button type="button" onClick={onRemover} title="Tirar"
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer">
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}

const ESCALA_MIN = 0.9;
const ESCALA_MAX = 1.8;

// minha versao: REACOES com emoji — botao (rapidas + grade) e as "pilulas" embaixo da bolha
const EMOJIS_RAPIDOS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const EMOJIS_MAIS = [
    "😀", "😁", "😅", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "🤔", "🤨", "😐", "🙄", "😴", "😷",
    "🤒", "😭", "😡", "🤯", "🥳", "😇", "🤝", "👏", "🙌", "👌", "✌️", "🤞", "💪", "👀", "🔥", "✨",
    "🎉", "💯", "✅", "❌", "⚠️", "📌", "📞", "💬", "⏰", "🚀", "💡", "🛠️", "📶", "⚡", "🌧️", "☀️",
];

function BotaoReagir({ onEscolher, minha, className }: { onEscolher: (e: string) => void; minha?: string; className?: string }) {
    const [aberto, setAberto] = useState(false);
    const [mais, setMais] = useState(false);
    const escolher = (e: string) => { onEscolher(e === minha ? "" : e); setAberto(false); setMais(false); };
    return (
        <Popover open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) setMais(false); }}>
            <PopoverTrigger asChild>
                <button type="button" title="Reagir"
                    className={cn("self-center p-1.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded-lg transition-all opacity-40 group-hover:opacity-100 cursor-pointer shrink-0", aberto && "opacity-100 text-primary", className)}>
                    <SmilePlus className="h-3.5 w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-auto p-1.5 rounded-2xl">
                <div className="flex items-center gap-0.5">
                    {EMOJIS_RAPIDOS.map((e) => (
                        <button key={e} type="button" onClick={() => escolher(e)}
                            className={cn("h-9 w-9 text-xl rounded-full hover:bg-muted hover:scale-125 transition-transform cursor-pointer", minha === e && "bg-primary/20")}>{e}</button>
                    ))}
                    <button type="button" onClick={() => setMais((v) => !v)} title="Mais emojis"
                        className="h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground cursor-pointer"><Plus className="h-4 w-4" /></button>
                </div>
                {mais && (
                    <div className="grid grid-cols-8 gap-0.5 mt-1.5 pt-1.5 border-t border-border/50 max-w-[300px]">
                        {EMOJIS_MAIS.map((e) => (
                            <button key={e} type="button" onClick={() => escolher(e)}
                                className={cn("h-8 w-8 text-lg rounded-lg hover:bg-muted cursor-pointer", minha === e && "bg-primary/20")}>{e}</button>
                        ))}
                    </div>
                )}
                {minha && <p className="text-[10px] text-muted-foreground text-center mt-1">clique no seu emoji de novo para tirar</p>}
            </PopoverContent>
        </Popover>
    );
}

function ReacoesMsg({ reacoes, fromMe, onClique }: {
    reacoes?: Record<string, { e: string; n?: string | null }> | null; fromMe: boolean; onClique: (emoji: string) => void;
}) {
    if (!reacoes) return null;
    const grupos = new Map<string, { qtd: number; nomes: string[]; minha: boolean }>();
    for (const [quem, r] of Object.entries(reacoes)) {
        if (!r?.e) continue;
        const g = grupos.get(r.e) || { qtd: 0, nomes: [], minha: false };
        g.qtd++;
        g.nomes.push(quem === "eu" ? "Você" : (r.n || "Contato"));
        if (quem === "eu") g.minha = true;
        grupos.set(r.e, g);
    }
    if (!grupos.size) return null;
    return (
        <div className={cn("flex flex-wrap gap-1 -mt-2 relative z-[1] px-2", fromMe ? "justify-end" : "justify-start")}>
            {[...grupos.entries()].map(([e, g]) => (
                <button key={e} type="button" onClick={() => onClique(g.minha ? "" : e)}
                    title={`${g.nomes.join(", ")}${g.minha ? " — clique para tirar a sua" : " — clique para reagir igual"}`}
                    className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs shadow-sm bg-popover cursor-pointer hover:scale-105 transition-transform",
                        g.minha ? "border-primary/60 bg-primary/15" : "border-border/60")}>
                    <span className="text-sm leading-none">{e}</span>
                    {g.qtd > 1 && <span className="text-[10px] font-semibold text-muted-foreground">{g.qtd}</span>}
                </button>
            ))}
        </div>
    );
}

// minha versao: contato encaminhado (vCard) com "Conversar" e "Salvar"
type ContatoVcard = { nome?: string; empresa?: string | null; numeros?: { waid: string | null; texto: string }[] };

function CartaoContato({ c, fromMe, onConversar, onSalvar }: {
    c: ContatoVcard; fromMe: boolean;
    onConversar: (numero: { waid: string | null; texto: string }, nome: string) => void;
    onSalvar: (numero: { waid: string | null; texto: string }, nome: string) => void;
}) {
    const nome = c.nome || "Contato";
    const numeros = c.numeros || [];
    const ini = (nome.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map((s) => s[0]).join("").slice(0, 2) || "?").toUpperCase();
    return (
        <div className={cn("rounded-xl mb-1.5 min-w-[220px] overflow-hidden", fromMe ? "bg-black/5 dark:bg-white/10" : "bg-muted/50")}>
            <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 flex items-center justify-center text-xs font-bold shrink-0">{ini}</div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{nome}</p>
                    {c.empresa && <p className="text-[11px] opacity-70 truncate">{c.empresa}</p>}
                    {numeros.length === 0 && <p className="text-[11px] opacity-60">número não disponível</p>}
                </div>
            </div>
            {numeros.map((n, i) => (
                <div key={i} className="border-t border-current/10 px-3 py-1.5">
                    <p className="text-xs opacity-80 mb-1">
                        {n.texto || (n.waid ? formatarTelefone(n.waid) : "")}
                        {!n.waid && <span className="ml-1 opacity-60">· sem WhatsApp?</span>}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 pb-1">
                        <button type="button" onClick={() => onConversar(n, nome)}
                            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold bg-primary/15 hover:bg-primary/25 text-current cursor-pointer">
                            <MessageCircle className="h-3.5 w-3.5" /> Conversar
                        </button>
                        <button type="button" onClick={() => onSalvar(n, nome)}
                            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold bg-primary/15 hover:bg-primary/25 text-current cursor-pointer">
                            <UserPlus className="h-3.5 w-3.5" /> Salvar
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// minha versao: foto de quem mandou a mensagem no grupo (cache por sessao+jid, fila de no maximo 4 buscas)
const fotoMembroCache = new Map<string, Promise<string | null>>();
let fotoMembroAtivas = 0;
const fotoMembroFila: (() => void)[] = [];
function buscarFotoMembro(sessionId: string, jid: string): Promise<string | null> {
    const k = `${sessionId}|${jid}`;
    let p = fotoMembroCache.get(k);
    if (!p) {
        p = new Promise<string | null>((resolve) => {
            const rodar = () => {
                fotoMembroAtivas++;
                fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/profile-picture`, { method: "POST" })
                    .then((r) => r.json()).then((d) => resolve(d?.profilePicUrl || null)).catch(() => resolve(null))
                    .finally(() => { fotoMembroAtivas--; fotoMembroFila.shift()?.(); });
            };
            if (fotoMembroAtivas < 4) rodar(); else fotoMembroFila.push(rodar);
        });
        fotoMembroCache.set(k, p);
    }
    return p;
}

function FotoMembro({ sessionId, jid, nome, onClick }: { sessionId: string; jid?: string | null; nome: string; onClick?: () => void }) {
    const [foto, setFoto] = useState<string | null>(null);
    useEffect(() => {
        let ativo = true;
        setFoto(null);
        if (jid) buscarFotoMembro(sessionId, jid).then((u) => { if (ativo) setFoto(u); });
        return () => { ativo = false; };
    }, [sessionId, jid]);
    return (
        <button type="button" onClick={onClick} title={`${nome} · abrir conversa privada`} className="self-start mt-0.5 shrink-0 rounded-full cursor-pointer hover:ring-2 hover:ring-primary/40 transition">
            <Avatar className="h-8 w-8">
                {foto && <AvatarImage src={foto} alt={nome} />}
                <AvatarFallback className="text-[10px] font-semibold bg-gradient-to-br from-primary/25 to-primary/10 text-foreground">
                    {(nome.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map((s) => s[0]).join("").slice(0, 2) || "?").toUpperCase()}
                </AvatarFallback>
            </Avatar>
        </button>
    );
}

interface ChatWindowProps {
    sessionId: string;
    jid: string;
    name?: string;
    onBack?: () => void;
    onOpenChat?: (jid: string, name?: string) => void; // minha versao: abrir conversa a partir do painel (membro do grupo)
}

const PAGE_LIMIT = 50;

// ─── Lazy media ────────
// minha versao: se a imagem nao carregar (servidor reiniciando, rede, arquivo sendo gravado) tenta de novo
// sozinha 3 vezes e depois mostra "tentar de novo". Antes ficava invisivel (opacidade 0) para sempre.
const ESPERAS_IMG_MS = [1500, 4000, 10000];
function LazyMedia({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [tentativa, setTentativa] = useState(0);
    const [falhou, setFalhou] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    const aoErrar = () => {
        if (tentativa >= ESPERAS_IMG_MS.length) { setFalhou(true); return; }
        const n = tentativa;
        setTimeout(() => setTentativa(n + 1), ESPERAS_IMG_MS[n]);
    };
    const url = tentativa ? `${src}${src.includes("?") ? "&" : "?"}t=${tentativa}` : src;
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {falhou ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); setFalhou(false); setTentativa(tentativa + 1); }}
                    className="h-28 w-56 max-w-full rounded-xl bg-muted/40 flex flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground hover:bg-muted/60 cursor-pointer">
                    <ImageOff className="h-5 w-5" /> A imagem não carregou · tentar de novo
                </button>
            ) : visible ? <img key={url} src={url} alt={alt} onClick={onClick} className={`max-w-full max-h-60 object-cover rounded-xl cursor-zoom-in transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} onLoad={() => setLoaded(true)} onError={aoErrar} loading="lazy" />
                : <div className="h-40 bg-muted/30 rounded-xl animate-pulse" />}
        </div>
    );
}

// minha versao: mensagem de midia que ainda nao tem arquivo (baixando na fila, ou falhou de vez)
function MidiaPendente({ msg, sessionId }: { msg: Message; sessionId: string }) {
    const [pedindo, setPedindo] = useState(false);
    const pend = msg.extra?.midiaPendente;
    const rotulo = msg.type === "IMAGE" ? "imagem" : msg.type === "VIDEO" ? "vídeo" : msg.type === "AUDIO" ? "áudio" : msg.type === "STICKER" ? "figurinha" : "arquivo";
    if (pend && !pend.falhou) {
        return (
            <div className={cn("mb-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs", msg.fromMe ? "bg-black/5 dark:bg-white/10" : "bg-muted/50")}>
                <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" /> Baixando {rotulo}…
            </div>
        );
    }
    return (
        <div className={cn("mb-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs", msg.fromMe ? "bg-black/5 dark:bg-white/10" : "bg-muted/50")}>
            <ImageOff className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{pend ? `O ${rotulo} não baixou do WhatsApp.` : `${rotulo[0].toUpperCase()}${rotulo.slice(1)} indisponível no painel.`}</span>
            {pend && (
                <button type="button" disabled={pedindo} className="font-semibold underline underline-offset-2 disabled:opacity-50 cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation();
                        setPedindo(true);
                        tentarBaixarMidia(sessionId, msg.keyId).then(exigirSucesso)
                            .then(() => toast.info("Tentando baixar de novo…"))
                            .catch((err: any) => toast.error(err?.message || "Não consegui"))
                            .finally(() => setPedindo(false));
                    }}>tentar de novo</button>
            )}
        </div>
    );
}
function LazyVideo({ src, onBaixar }: { src: string; onBaixar?: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {/* minha versao: player proprio (continua com preload none: so baixa ao tocar) */}
            {visible ? <ReprodutorVideo key={src} src={src} onBaixar={onBaixar} />
                : <div className="h-32 bg-muted/30 rounded-xl animate-pulse flex items-center justify-center"><Video className="h-6 w-6 text-muted-foreground/50" /></div>}
        </div>
    );
}

function useDateLabel() {
    const t = useTranslations("chat");
    const cache = useRef(new Map<string, string>());
    return (timestamp: string): string => {
        const cached = cache.current.get(timestamp);
        if (cached) return cached;
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        let label: string;
        if (diffDays === 0) label = t("today");
        else if (diffDays === 1) label = t("yesterday");
        else label = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        cache.current.set(timestamp, label);
        return label;
    };
}

function handleDownload(url: string, fileName: string) {
    toast.info("Downloading...");
    fetch(url).then(res => { if (!res.ok) throw new Error(); return res.blob(); }).then(blob => {
        const dlUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = dlUrl; link.download = fileName;
        document.body.appendChild(link);
        link.click(); link.remove();
        window.URL.revokeObjectURL(dlUrl);
    }).catch(() => toast.error("Falha no download!"));
}

// ─── Context Menu ──────────────────
interface ContextMenuState {
    x: number;
    y: number;
    msg: Message;
}
function ContextMenu({ state, onClose, onReply, onDelete, fixada, onFixar, onEncaminhar }: { state: ContextMenuState; onClose: () => void; onReply: (msg: Message) => void; onDelete: (msg: Message) => void; fixada: boolean; onFixar: (msg: Message, fixar: boolean, dias?: 1 | 7 | 30) => void; onEncaminhar: (msg: Message) => void }) {
    const t = useTranslations("chat");
    const ref = useRef<HTMLDivElement>(null);
    const [submenu, setSubmenu] = useState(false);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const items: { label: string; icon: any; action: () => void; dangerous?: boolean }[] = submenu ? [
        { label: "Voltar", icon: ChevronLeft, action: () => setSubmenu(false) },
        { label: "Por 24 horas", icon: Pin, action: () => { onFixar(state.msg, true, 1); onClose(); } },
        { label: "Por 7 dias", icon: Pin, action: () => { onFixar(state.msg, true, 7); onClose(); } },
        { label: "Por 30 dias", icon: Pin, action: () => { onFixar(state.msg, true, 30); onClose(); } },
    ] : [
        { label: t("reply"), icon: CornerUpLeft, action: () => { onReply(state.msg); onClose(); } },
        { label: t("copy"), icon: Copy, action: () => { navigator.clipboard.writeText(state.msg.content || "").then(() => toast.success(t("copied"))).catch(() => {}); onClose(); } },
        // minha versao: encaminhar (texto e midia com arquivo; contato e mensagem apagada ficam de fora)
        ...(state.msg.type !== "CONTACT" && !(state.msg.extra as any)?.apagada && (state.msg.type === "TEXT" || state.msg.mediaUrl)
            ? [{ label: "Encaminhar", icon: Forward, action: () => { onEncaminhar(state.msg); onClose(); } }]
            : []),
        // minha versao: fixar a mensagem na conversa (todos veem, como no WhatsApp)
        fixada
            ? { label: "Desafixar", icon: PinOff, action: () => { onFixar(state.msg, false); onClose(); } }
            : { label: "Fixar…", icon: Pin, action: () => setSubmenu(true) },
        { label: t("delete"), icon: Trash2, action: () => { onDelete(state.msg); onClose(); }, dangerous: true },
        { label: t("info"), icon: Info, action: () => { toast.info(`ID: ${state.msg.keyId}\nStatus: ${state.msg.status}\nTime: ${new Date(state.msg.timestamp).toLocaleString()}`); onClose(); } },
    ];

    // Adjust position to not overflow viewport
    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (state.x > window.innerWidth - 180) style.left = state.x - 180;
    if (state.y > window.innerHeight - 200) style.top = state.y - 180;

    return (
        <div ref={ref} style={style} className="w-44 rounded-xl bg-popover border shadow-xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button key={i} onClick={item.action} className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                    item.dangerous ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted"
                )}>
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// minha versao: destaca o termo buscado dentro do trecho (negrito), sem depender de HTML
function realcar(texto: string, termo: string): React.ReactNode {
    const t = termo.trim();
    if (!t) return texto;
    // mostra um trecho ao redor da 1a ocorrencia (o preview e truncado)
    const i = texto.toLowerCase().indexOf(t.toLowerCase());
    const base = i > 40 ? "…" + texto.slice(i - 30) : texto;
    const j = base.toLowerCase().indexOf(t.toLowerCase());
    if (j < 0) return base;
    return (<>{base.slice(0, j)}<mark className="bg-primary/30 text-foreground rounded px-0.5">{base.slice(j, j + t.length)}</mark>{base.slice(j + t.length)}</>);
}

// ─── Main Component ─────────────────
export function ChatWindow({ sessionId, jid, name, onBack, onOpenChat }: ChatWindowProps) {
    const t = useTranslations("chat");
    const tCommon = useTranslations("common");
    const [messages, setMessages] = useState<Message[]>([]);
    // minha versao: keyIds de mensagens que chegaram agora pelo socket (so elas animam a entrada; abrir a conversa ou carregar antigas nao)
    const novasRef = useRef<Set<string>>(new Set());
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [uploadType, setUploadType] = useState<string>("image");
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [newMsgBadge, setNewMsgBadge] = useState(false);

    // Delete confirmation
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    // minha versao: mensagens fixadas nesta conversa (ate 3) e qual delas a barra mostra
    const [fixadas, setFixadas] = useState<{ keyId: string; por: string | null; content: string | null; type: string | null; fromMe: boolean | null; pushName: string | null }[]>([]);
    const [fixadaIdx, setFixadaIdx] = useState(0);
    // minha versao: procurar na conversa (lupa) e "pular ate a mensagem"
    const [buscaAberta, setBuscaAberta] = useState(false);
    const [buscaQ, setBuscaQ] = useState("");
    const [buscaResultados, setBuscaResultados] = useState<{ keyId: string; content: string | null; type: string; fromMe: boolean; senderName: string | null; pushName: string | null; timestamp: string }[]>([]);
    const [buscaTotal, setBuscaTotal] = useState(0);
    const [buscando, setBuscando] = useState(false);
    // janelaBusca = estou vendo uma janela "saltada" (nao e o fim ao vivo); as mensagens novas nao entram aqui
    const [janelaBusca, setJanelaBusca] = useState(false);
    const janelaBuscaRef = useRef(false);
    janelaBuscaRef.current = janelaBusca;

    // Interactive message dialog state
    const [interactiveDialogOpen, setInteractiveDialogOpen] = useState(false);
    // minha versao: foto do contato no cabecalho + lightbox das imagens
    const [chatPic, setChatPic] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<string | null>(null);
    const [encaminhando, setEncaminhando] = useState<Message | null>(null); // minha versao: encaminhar
    // minha versao: fotos carregadas desta conversa, em ordem (anterior/proxima no visualizador)
    const fotosDaConversa = useMemo(
        () => messages.filter((m) => m.type === "IMAGE" && m.mediaUrl).map((m) => m.mediaUrl as string),
        [messages],
    );
    // minha versao: painel de dados + @mencoes em grupo
    const isGroup = jid.endsWith("@g.us");
    const [infoOpen, setInfoOpen] = useState(false);
    const [participants, setParticipants] = useState<Participante[]>([]);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionsSel, setMentionsSel] = useState<{ jid: string; label: string; tag: string }[]>([]);
    useEffect(() => {
        setInfoOpen(false); setMentionsSel([]); setMentionQuery(null); setParticipants([]);
        if (!isGroup) return;
        let active = true;
        fetch(`/api/groups/${sessionId}/${encodeURIComponent(jid)}`)
            .then((r) => r.json())
            .then((d) => { if (active && Array.isArray(d?.participantsInfo)) setParticipants(d.participantsInfo); })
            .catch(() => {});
        return () => { active = false; };
    }, [sessionId, jid, isGroup]);
    const mentionCandidates = useMemo(() => {
        if (mentionQuery === null) return [];
        const q = mentionQuery.toLowerCase();
        return participants.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p.phone || "").includes(q)).slice(0, 8);
    }, [mentionQuery, participants]);
    // "@247484672655500" -> "@Major Correia" ao exibir mensagens do grupo
    const mentionNames = useMemo(() => {
        const m = new Map<string, string>();
        participants.forEach((p) => {
            const nome = p.name || formatarTelefone(p.phone);
            if (!nome) return;
            m.set(p.id.split("@")[0], nome);
            if (p.phone) m.set(p.phone, nome);
        });
        return m;
    }, [participants]);
    const renderText = (txt?: string | null) =>
        !txt || mentionNames.size === 0 ? txt : txt.replace(/@(\d{6,})/g, (all, n) => (mentionNames.has(n) ? `@${mentionNames.get(n)}` : all));
    // minha versao: nome de quem escreveu (em grupo: a pessoa, nunca o ID; minhas: o atendente)
    const nomeAutor = (m: { fromMe: boolean; pushName?: string | null; senderName?: string | null; senderJid?: string | null; sentBy?: string | null }) => {
        if (m.fromMe) return m.sentBy ? `${t("you")} · ${m.sentBy}` : t("you");
        if (!isGroup) return nomeSalvo || name || formatarTelefone(jid.split("@")[0]) || "Contato";
        const p = m.senderJid ? participants.find((x) => x.id === m.senderJid) : undefined;
        const tel = m.senderJid?.endsWith("@s.whatsapp.net") ? formatarTelefone(m.senderJid.split("@")[0]) : (p?.phone ? formatarTelefone(p.phone) : "");
        return m.pushName || m.senderName || p?.name || tel || "Membro";
    };
    // minha versao: tamanho do texto da conversa (guardado no navegador; padrao 125%)
    const [escala, setEscala] = useState(1.25);
    useEffect(() => {
        try { const v = parseFloat(localStorage.getItem("wa-chat-escala") || ""); if (v >= ESCALA_MIN && v <= ESCALA_MAX) setEscala(v); } catch { /* sem storage */ }
    }, []);
    const mudarEscala = (delta: number, fixo?: number) => {
        setEscala((atual) => {
            const v = Math.round(Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, fixo ?? atual + delta)) * 100) / 100;
            try { localStorage.setItem("wa-chat-escala", String(v)); } catch { /* sem storage */ }
            return v;
        });
    };
    // minha versao: Ctrl + roda do mouse muda o zoom da conversa (igual WhatsApp Web), usando o MESMO escala dos botoes A-/A+
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onWheel = (ev: WheelEvent) => {
            if (!ev.ctrlKey) return;      // sem Ctrl, rolagem normal
            ev.preventDefault();          // evita o zoom do navegador
            setEscala((atual) => {
                const v = Math.round(Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, atual + (ev.deltaY < 0 ? 0.1 : -0.1))) * 100) / 100;
                try { localStorage.setItem("wa-chat-escala", String(v)); } catch { /* sem storage */ }
                return v;
            });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // minha versao: conversa privada com numero fora da agenda -> aviso + adicionar ali mesmo
    const [foraAgenda, setForaAgenda] = useState<{ alvo: string; sugestao: string } | null>(null);
    const [addNome, setAddNome] = useState<string | null>(null); // null = formulario fechado
    const [addCelular, setAddCelular] = useState(true);
    const [salvandoContato, setSalvandoContato] = useState(false);
    const [nomeSalvo, setNomeSalvo] = useState<string | null>(null);
    const [dlgContato, setDlgContato] = useState<{ numero: string; nome: string; modo: "numero" | "agenda" } | null>(null);
    useEffect(() => {
        setForaAgenda(null); setAddNome(null); setNomeSalvo(null);
        if (isGroup || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) return;
        let ativo = true;
        fetch(`/api/contacts/${sessionId}/${encodeURIComponent(jid)}?leve=1`)
            .then((r) => r.json())
            .then((d) => {
                const c = d?.data;
                if (!ativo || !c || c.saved) return;
                setForaAgenda({ alvo: c.phone ? `${c.phone}@s.whatsapp.net` : jid, sugestao: c.notify || c.verifiedName || "" });
            })
            .catch(() => {});
        return () => { ativo = false; };
    }, [sessionId, jid, isGroup]);
    const salvarNaAgenda = async () => {
        const n = (addNome || "").trim();
        if (!n || !foraAgenda) return;
        setSalvandoContato(true);
        try {
            const r = await salvarContato(sessionId, foraAgenda.alvo, n, addCelular && foraAgenda.alvo.endsWith("@s.whatsapp.net"));
            if (r.celular?.ok) toast.success(`"${n}" salvo na agenda (painel e celular)`);
            else if (r.celular) toast.warning(`"${n}" salvo no painel; no celular falhou: ${r.celular.erro}`);
            else toast.success(`"${n}" salvo na agenda`);
            setNomeSalvo(n); setForaAgenda(null); setAddNome(null);
        } catch (e: any) { toast.error(e?.message || "Falha ao salvar"); }
        finally { setSalvandoContato(false); }
    };

    // minha versao: "Assinar" (o cliente ve "*Nome*" e a mensagem embaixo) — grupo e privado tem preferencias separadas
    const chaveAssinar = isGroup ? "assinarGrupo" : "assinar";
    const [assinar, setAssinar] = useState(false);
    useEffect(() => {
        setAssinar(lerAlertas()[chaveAssinar]);
        const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setAssinar(!!d[chaveAssinar]); };
        window.addEventListener(EVENTO_ALERTAS, h);
        return () => window.removeEventListener(EVENTO_ALERTAS, h);
    }, [chaveAssinar]);
    // a bolha ja mostra o atendente em cima; esconde a assinatura repetida do texto
    const semAssinatura = (m: Message) => {
        if (!m.fromMe || !m.sentBy || !m.content) return m.content;
        for (const p of [`*${m.sentBy}*\n`, `*${m.sentBy}:*\n`]) if (m.content.startsWith(p)) return m.content.slice(p.length);
        return m.content;
    };
    useEffect(() => {
        let active = true;
        setChatPic(null);
        (async () => {
            try {
                const res = await fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/profile-picture`, { method: "POST" });
                const data = await res.json();
                if (active && data?.profilePicUrl) setChatPic(data.profilePicUrl);
            } catch {}
        })();
        return () => { active = false; };
    }, [sessionId, jid]);

    const { getSocket, joinSession } = useSocket();
    const getDateLabel = useDateLabel();

    const scrollToBottom = useCallback((smooth = true) => {
        bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }, []);

    const fetchMessages = useCallback(async (before?: string) => {
        try {
            if (!before) setLoading(true);
            else setLoadingMore(true);
            const data: any = await getChatMessages(sessionId, jid, PAGE_LIMIT, before);
            if (!before) { setMessages(data.messages || []); setAutoScroll(true); setJanelaBusca(false); }
            else if (data.messages?.length > 0) setMessages(prev => [...(data.messages || []), ...prev]);
            setHasMore(data.hasMore);
            if (data.messages?.length > 0) setOldestTimestamp(data.messages[0].timestamp);
        } catch (e) { console.error("Failed to load messages", e); }
        finally { setLoading(false); setLoadingMore(false); }
    }, [sessionId, jid]);

    // minha versao: busca na conversa (debounce) — so quando a lupa esta aberta
    useEffect(() => {
        if (!buscaAberta) return;
        const termo = buscaQ.trim();
        if (termo.length < 2) { setBuscaResultados([]); setBuscaTotal(0); setBuscando(false); return; }
        setBuscando(true);
        const t = setTimeout(() => {
            buscarNaConversa(sessionId, jid, termo)
                .then((r: any) => { setBuscaResultados(r?.resultados || []); setBuscaTotal(r?.total || 0); })
                .catch(() => { setBuscaResultados([]); setBuscaTotal(0); })
                .finally(() => setBuscando(false));
        }, 300);
        return () => clearTimeout(t);
    }, [buscaQ, buscaAberta, sessionId, jid]);

    // fecha a busca e zera ao trocar de conversa
    useEffect(() => { setBuscaAberta(false); setBuscaQ(""); setBuscaResultados([]); setBuscaTotal(0); setJanelaBusca(false); }, [jid]);

    const destacarMensagem = useCallback((keyId: string) => {
        requestAnimationFrame(() => {
            const el = document.getElementById(`msg-${keyId}`);
            if (el) {
                el.scrollIntoView({ behavior: "auto", block: "center" });
                el.classList.add("ring-2", "ring-primary", "rounded-xl");
                setTimeout(() => el.classList.remove("ring-2", "ring-primary", "rounded-xl"), 1800);
            } else {
                toast.info("Essa mensagem é mais antiga que as carregadas. Role para cima para carregar mais.");
            }
        });
    }, []);

    // minha versao: pular ate um resultado (carrega a janela ao redor; se nao for o fim, entra em modo "janela")
    const pularParaResultado = useCallback(async (keyId: string) => {
        // ja esta na tela? so rola e destaca
        if (document.getElementById(`msg-${keyId}`)) { destacarMensagem(keyId); return; }
        try {
            const data: any = await pularParaMensagem(sessionId, jid, keyId);
            if (!data?.achou) { toast.info("Mensagem não encontrada"); return; }
            setMessages(data.messages || []);
            setHasMore(!!data.temMaisAntigas);
            setJanelaBusca(!!data.temMaisNovas); // se nao ha mais novas, a janela chega ao fim = modo normal
            setAutoScroll(false);
            setOldestTimestamp(data.messages?.[0]?.timestamp || null);
            destacarMensagem(keyId);
        } catch (e: any) { toast.error(e?.message || "Não consegui abrir a mensagem"); }
    }, [sessionId, jid, destacarMensagem]);

    const voltarAoFim = useCallback(() => {
        setJanelaBusca(false);
        fetchMessages().then(() => scrollToBottom(false));
    }, [fetchMessages, scrollToBottom]);

    // minha versao: enviar mensagem de voz (microfone). O servidor converte para ogg/opus (ver lib/audio-voz).
    const enviarVoz = useCallback(async (file: File, segundos: number) => {
        const fd = new FormData();
        fd.append("sessionId", sessionId);
        fd.append("jid", jid);
        fd.append("file", file);
        fd.append("type", "voice");
        fd.append("duration", String(segundos));
        exigirSucesso(await sendMediaMessage(fd));
        // a mensagem enviada volta pelo socket; se estiver vendo um resultado antigo, nao mexe na tela
        if (!janelaBuscaRef.current) { setTimeout(() => fetchMessages().then(() => scrollToBottom(true)), 700); }
    }, [sessionId, jid, fetchMessages, scrollToBottom]);

    useEffect(() => { novasRef.current.clear(); setMessages([]); setOldestTimestamp(null); setHasMore(false); fetchMessages(); }, [fetchMessages]);

    // Auto focus input when chat changes and finished loading
    useEffect(() => {
        if (!loading && inputRef.current) {
            // A tiny delay ensures React has fully flushed the DOM for the new chat
            setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
        }
    }, [jid, loading]);

    // minha versao: mensagens fixadas (carrega ao abrir e quando alguem fixa/desfixa, aqui ou no celular)
    const carregarFixadas = useCallback(() => {
        getEstadoConversa(sessionId, jid)
            .then((e: any) => { setFixadas(e?.fixadas || []); setFixadaIdx(0); })
            .catch(() => setFixadas([]));
    }, [sessionId, jid]);
    useEffect(() => { setFixadas([]); carregarFixadas(); }, [carregarFixadas]);

    // Socket real-time
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        // minha versao: reconectou (rede caiu, servidor reiniciou, aba suspensa) -> busca o que chegou nesse
        // meio-tempo e mescla com o que ja esta na tela. Antes essas mensagens so apareciam ao reabrir a conversa.
        let primeiraConexao = !socket.connected;
        const onConnect = () => {
            joinSession(sessionId);
            if (primeiraConexao) { primeiraConexao = false; return; }
            getChatMessages(sessionId, jid, PAGE_LIMIT).then((data: any) => {
                const novas: Message[] = data?.messages || [];
                if (!novas.length) return;
                setMessages(prev => {
                    const porId = new Map(prev.map(m => [m.keyId, m]));
                    novas.forEach(n => porId.set(n.keyId, { ...porId.get(n.keyId), ...n }));
                    return Array.from(porId.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                });
            }).catch(() => {});
            carregarFixadas();
        };
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);
        const onFixadas = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            const nj = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
            if (d.jid === nj || d.jid === jid) carregarFixadas();
        };
        socket.on("chat.fixadas", onFixadas);
        const normalizedJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
        const handler = (newMessages: Message[]) => {
            setMessages(prev => {
                // minha versao: so mensagens DESTA sessao (o socket esta nas salas de todas as sessoes)
                let relevant = newMessages.filter(m => (m as any).sessionKey === sessionId && (m.remoteJid === normalizedJid || prev.some(p => p.remoteJid === m.remoteJid)));
                // minha versao: vendo uma janela saltada da busca -> atualiza as que ja estao na tela (status/edicao),
                // mas NAO injeta mensagem nova (apareceria fora de contexto). Ela entra ao "voltar ao fim".
                if (janelaBuscaRef.current) {
                    const presentes = new Set(prev.map(p => p.keyId));
                    relevant = relevant.filter(m => presentes.has(m.keyId));
                }
                if (relevant.length === 0) return prev;
                // minha versao: mescla com a versao ja carregada (o socket nao traz citacao/atendente)
                const porId = new Map(prev.map(m => [m.keyId, m]));
                for (const n of relevant) {
                    const old = porId.get(n.keyId);
                    if (!old && !janelaBuscaRef.current && ((n as any).live || (n.fromMe && Date.now() - new Date(n.timestamp).getTime() < 30000))) novasRef.current.add(n.keyId);
                    let quoted = n.quoted ?? old?.quoted ?? null;
                    if (!quoted && n.quoteId) {
                        const q = porId.get(n.quoteId);
                        if (q) quoted = { keyId: q.keyId, content: q.content, fromMe: q.fromMe, senderJid: q.senderJid ?? null, pushName: q.pushName ?? null, senderName: q.senderName ?? null, sentBy: q.sentBy ?? null, type: q.type };
                    }
                    porId.set(n.keyId, { ...old, ...n, quoted, senderName: n.senderName || old?.senderName || null, sentBy: n.sentBy || old?.sentBy || null });
                }
                return Array.from(porId.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            });
            // chegou mensagem nesta conversa com ela aberta na tela -> continua lida
            if (newMessages.some(m => (m as any).sessionKey === sessionId && m.remoteJid === normalizedJid && !m.fromMe && (m as any).live)) marcarLidaEmBreve();
        };
        // minha versao: tiques (entregue/lida) e reacoes em tempo real
        const onStatus = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setMessages(prev => prev.some(m => m.keyId === d.keyId) ? prev.map(m => m.keyId === d.keyId ? { ...m, status: d.status } : m) : prev);
        };
        const onReacao = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setMessages(prev => prev.some(m => m.keyId === d.keyId) ? prev.map(m => m.keyId === d.keyId ? { ...m, reacoes: d.reacoes } : m) : prev);
        };
        // apagada pelo painel em outra tela/aba -> some daqui tambem
        const onRemovida = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setMessages(prev => prev.some(m => m.keyId === d.keyId) ? prev.filter(m => m.keyId !== d.keyId) : prev);
        };
        socket.on("message.update", handler);
        socket.on("message.status", onStatus);
        socket.on("message.reaction", onReacao);
        socket.on("message.removed", onRemovida);
        return () => {
            socket.off("connect", onConnect); socket.off("message.update", handler);
            socket.off("message.status", onStatus); socket.off("message.reaction", onReacao);
            socket.off("message.removed", onRemovida); socket.off("chat.fixadas", onFixadas);
        };
    }, [sessionId, jid, getSocket, joinSession, carregarFixadas]);

    // minha versao: abrir a conversa = lida (zera o contador da lista e manda o recibo de leitura ao WhatsApp)
    const lidaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const marcarLidaEmBreve = () => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        if (lidaTimer.current) clearTimeout(lidaTimer.current);
        lidaTimer.current = setTimeout(() => { marcarConversaLida(sessionId, jid).catch(() => {}); }, 1200);
    };
    useEffect(() => {
        marcarConversaLida(sessionId, jid).catch(() => {});
        // voltou para a aba com a conversa aberta
        const h = () => { if (document.visibilityState === "visible") marcarConversaLida(sessionId, jid).catch(() => {}); };
        document.addEventListener("visibilitychange", h);
        return () => { document.removeEventListener("visibilitychange", h); if (lidaTimer.current) clearTimeout(lidaTimer.current); };
    }, [sessionId, jid]);

    // minha versao: reagir (otimista: ja mostra; o WhatsApp confirma pelo socket)
    const reagir = async (msg: Message, emoji: string) => {
        const antes = msg.reacoes || null;
        setMessages(prev => prev.map(m => {
            if (m.keyId !== msg.keyId) return m;
            const r = { ...(m.reacoes || {}) };
            if (emoji) r["eu"] = { e: emoji, n: null }; else delete r["eu"];
            return { ...m, reacoes: r };
        }));
        try { exigirSucesso(await reagirMensagem(sessionId, msg.keyId, emoji)); }
        catch (e: any) {
            toast.error(e?.message || "Não consegui reagir");
            setMessages(prev => prev.map(m => m.keyId === msg.keyId ? { ...m, reacoes: antes } : m));
        }
    };

    useEffect(() => { if (autoScroll) scrollToBottom(false); }, [messages, autoScroll, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        setAutoScroll(atBottom);
        if (atBottom) setNewMsgBadge(false);
        if (el.scrollTop < 100 && hasMore && !loadingMore && oldestTimestamp) {
            const prevHeight = el.scrollHeight;
            fetchMessages(oldestTimestamp).then(() => {
                requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight; });
            });
        }
    }, [hasMore, loadingMore, oldestTimestamp, fetchMessages]);

    // minha versao: trava de reentrancia — Enter/clique repetido durante o envio NAO reenvia a mesma mensagem
    const enviandoRef = useRef(false);
    const handleSend = async () => {
        if (enviandoRef.current) return;      // ja esta enviando -> ignora o 2o Enter/clique
        if (!input.trim()) return;
        enviandoRef.current = true;
        // minha versao: na caixa aparece "@Nome"; pro WhatsApp vai "@<id>" + a lista de mencionados
        let texto = input;
        const mencoes: string[] = [];
        for (const m of mentionsSel) {
            const marca = "@" + m.label;
            if (texto.includes(marca)) { texto = texto.split(marca).join("@" + m.tag); mencoes.push(m.jid); }
        }
        const textoOriginal = input;          // para devolver se o envio falhar
        const respostaKey = replyingTo?.keyId;
        // limpa a caixa JA (otimista): evita reenvio e deixa a UX mais fluida (igual WhatsApp)
        setInput("");
        setReplyingTo(null);
        setMentionsSel([]);
        setMentionQuery(null);
        if (inputRef.current) inputRef.current.style.height = "auto";
        try {
            exigirSucesso(await sendChatMessage(sessionId, jid, texto, respostaKey, mencoes, assinar));
            tocarEnviada();
            setTimeout(() => fetchMessages(), 800);
            setTimeout(() => fetchMessages(), 2500); // pega o nome do atendente se o banco gravou depois
        } catch (e: any) {
            setInput(textoOriginal);          // falhou -> devolve o texto pra pessoa tentar de novo
            toast.error(e.message || "Failed to send");
        } finally {
            enviandoRef.current = false;
        }
    };

    // minha versao: detecta "@algo" antes do cursor (so em grupo) e abre a lista de membros
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";
        if (!isGroup || participants.length === 0) { setMentionQuery(null); return; }
        const caret = el.selectionStart ?? val.length;
        const m = /(^|\s)@([^\s@]*)$/.exec(val.slice(0, caret));
        if (m) { setMentionQuery(m[2]); setMentionStart(caret - m[2].length - 1); setMentionIndex(0); }
        else setMentionQuery(null);
    };

    const pickMention = (p: Participante) => {
        const el = inputRef.current;
        const caret = el?.selectionStart ?? input.length;
        const label = (p.name || formatarTelefone(p.phone) || p.id.split("@")[0]).replace(/\s+/g, " ").trim();
        const tag = p.id.split("@")[0];
        setInput(input.slice(0, mentionStart) + "@" + label + " " + input.slice(caret));
        setMentionsSel((prev) => (prev.some((x) => x.jid === p.id) ? prev : [...prev, { jid: p.id, label, tag }]));
        setMentionQuery(null);
        const pos = mentionStart + label.length + 2;
        requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (mentionQuery !== null && mentionCandidates.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionCandidates.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionCandidates[mentionIndex]); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMentionQuery(null); return; }
        }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Focus input when replying
    useEffect(() => {
        if (replyingTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyingTo]);


    // minha versao: PREVIA de envio (arrastar/soltar, colar Ctrl+V, ou arquivos soltos num contato da lista)
    const [previa, setPrevia] = useState<File[] | null>(null);
    const [legenda, setLegenda] = useState("");
    const [comoDocumento, setComoDocumento] = useState(false);
    const [enviandoPrevia, setEnviandoPrevia] = useState(false);
    const arrastoRef = useRef(0); // conta dragenter/dragleave (filhos disparam leave) -> sem piscar
    const LIMITE_MB = 50;
    const abrirPrevia = (lista: File[]) => {
        const ok = lista.filter((f) => f.size <= LIMITE_MB * 1024 * 1024);
        if (ok.length < lista.length) toast.error(`Arquivo acima de ${LIMITE_MB} MB não pode ser enviado`);
        if (!ok.length) return;
        setPrevia((atual) => [...(atual || []), ...ok].slice(0, 30));
        setLegenda((l) => l || "");
    };
    useEffect(() => {
        setPrevia(null); setLegenda(""); setComoDocumento(false);
        const vindo = pegarArquivos(jid);
        if (vindo?.length) abrirPrevia(vindo);
        const h = (e: Event) => {
            if ((e as CustomEvent).detail?.jid !== jid) return;
            const a = pegarArquivos(jid);
            if (a?.length) abrirPrevia(a);
        };
        window.addEventListener(EVENTO_ARQUIVOS_PENDENTES, h);
        return () => window.removeEventListener(EVENTO_ARQUIVOS_PENDENTES, h);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jid]);
    const enviarPrevia = async () => {
        if (!previa?.length) return;
        setEnviandoPrevia(true);
        const lista = [...previa];
        let ok = 0;
        for (let i = 0; i < lista.length; i++) {
            const enviado = await processFileUpload(lista[i], comoDocumento ? "document" : undefined, i === 0 ? legenda.trim() : "", true);
            if (enviado) ok++;
        }
        setEnviandoPrevia(false);
        setPrevia(null); setLegenda(""); setComoDocumento(false);
        if (ok) { toast.success(ok === 1 ? "Arquivo enviado" : `${ok} arquivos enviados`); tocarEnviada(); setTimeout(() => fetchMessages(), 900); }
    };
    const aoColar = (e: React.ClipboardEvent) => {
        const arquivos = Array.from(e.clipboardData?.files || []);
        if (arquivos.length) { e.preventDefault(); abrirPrevia(arquivos); }
    };

    // minha versao: ESC fecha o que estiver aberto; se nao houver nada, SAI da conversa (volta para a lista).
    // (fica depois dos estados dos dialogos para enxergar todos)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                // os dialogs/menus fecham sozinhos (Radix) — nao fecho a conversa junto
                if (previa?.length || deleteConfirmMsg || interactiveDialogOpen || dlgContato || mentionQuery !== null) return;
                if (lightbox) { e.preventDefault(); setLightbox(null); return; }
                if (infoOpen) { e.preventDefault(); setInfoOpen(false); return; }
                if (replyingTo) { e.preventDefault(); setReplyingTo(null); return; }
                e.preventDefault();
                if (onBack) onBack(); // sai da conversa
                return;
            }
            if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                toast.success("Atalhos", { description: "Enter: enviar\nShift+Enter: nova linha\nEsc: fechar/sair da conversa\n@: mencionar no grupo" });
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [replyingTo, mentionQuery, lightbox, infoOpen, previa, deleteConfirmMsg, interactiveDialogOpen, dlgContato, onBack]);

    const processFileUpload = async (file: File, explicitType?: string, caption = "", silencioso = false): Promise<boolean> => {
        // minha versao: figurinha — a rota /sticker converte a imagem (webp 512px) e envia
        if (explicitType === "sticker") {
            const fd = new FormData();
            fd.append("file", file);
            try {
                toast.info("Criando figurinha...");
                const r = await fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/sticker`, { method: "POST", body: fd });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.status === false) throw new Error(d?.message || "Falha ao enviar a figurinha");
                toast.success("Figurinha enviada!");
                tocarEnviada();
                setTimeout(() => fetchMessages(), 900);
                return true;
            } catch (e: any) { toast.error(e.message); return false; }
        }
        const formData = new FormData();
        formData.append("file", file);
        let type = explicitType;
        if (!type || type === '*') {
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }
        formData.append("type", type);
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);
        if (caption) formData.append("caption", caption);
        try {
            const aviso = toast.loading(`Enviando ${file.name}...`);
            exigirSucesso(await sendMediaMessage(formData));
            toast.dismiss(aviso);
            if (!silencioso) {
                toast.success("Enviado!");
                tocarEnviada();
                setTimeout(() => fetchMessages(), 800);
            }
            return true;
        } catch (error: any) {
            toast.error(`${file.name}: ${error.message || "falha ao enviar"}`);
            return false;
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFileUpload(file, uploadType);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const triggerUpload = (type: string) => {
        setUploadType(type);
        if (fileInputRef.current) {
            fileInputRef.current.accept = type === 'image' || type === 'sticker' ? "image/*" : type === 'video' ? "video/*" : type === 'audio' ? "audio/*" : "*/*";
            fileInputRef.current.click();
        }
    };

    // Right-click handler
    const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, msg });
    }, []);

    const displayName = nomeSalvo || name || formatarTelefone(jid.split('@')[0]) || jid.split('@')[0];

    // Loading is now handled gracefully inside the message list to prevent unmounting the layout

    return (
        <div
            className="flex-1 flex flex-col bg-muted/20 min-w-0 min-h-0 relative"
            // minha versao: so arquivos; contador evita o "pisca e some" (entrar num filho dispara dragleave no pai)
            onDragEnter={(e) => { if (!temArquivos(e)) return; e.preventDefault(); arrastoRef.current++; setIsDragging(true); }}
            onDragOver={(e) => { if (!temArquivos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDragLeave={(e) => { if (!temArquivos(e)) return; arrastoRef.current = Math.max(0, arrastoRef.current - 1); if (!arrastoRef.current) setIsDragging(false); }}
            onDrop={(e) => {
                if (!temArquivos(e)) return;
                e.preventDefault(); arrastoRef.current = 0; setIsDragging(false);
                const lista = Array.from(e.dataTransfer.files || []);
                if (lista.length) abrirPrevia(lista);
            }}
        >
            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onReply={(msg) => { setReplyingTo(msg); scrollToBottom(true); }}
                    onDelete={(msg) => {
                        setDeleteConfirmMsg(msg);
                    }}
                    fixada={fixadas.some((f) => f.keyId === contextMenu.msg.keyId)}
                    onFixar={(msg, fixar, dias) => {
                        fixarMensagem(sessionId, msg.keyId, fixar, dias || 7).then(exigirSucesso)
                            .then(() => toast.success(fixar ? "Mensagem fixada" : "Mensagem desafixada"))
                            .catch((e: any) => toast.error(e?.message || "Não consegui fixar"));
                    }}
                    onEncaminhar={(msg) => setEncaminhando(msg)}
                />
            )}

            {/* minha versao: encaminhar mensagem para outras conversas */}
            <EncaminharDialog sessionId={sessionId} keyId={encaminhando?.keyId || null}
                resumo={encaminhando ? (encaminhando.content || ({ IMAGE: "📷 Foto", VIDEO: "🎥 Vídeo", AUDIO: "🎤 Áudio", DOCUMENT: "📄 Documento", STICKER: "Figurinha" } as Record<string, string>)[encaminhando.type] || "Mensagem") : ""}
                onFechar={() => setEncaminhando(null)} />

            {/* Drag overlay */}
            {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-50 bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary flex items-center justify-center flex-col gap-3 rounded-lg m-2">
                    <Paperclip className="h-10 w-10 text-primary" />
                    <p className="text-lg font-semibold text-primary">Solte para enviar para {displayName}</p>
                    <p className="text-sm text-muted-foreground">Fotos, vídeos, áudios, documentos — vários de uma vez (até {LIMITE_MB} MB cada)</p>
                </div>
            )}

            {/* minha versao: previa de envio dos arquivos */}
            <Dialog open={!!previa?.length} onOpenChange={(v) => { if (!v && !enviandoPrevia) { setPrevia(null); setLegenda(""); } }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Enviar {previa?.length === 1 ? "arquivo" : `${previa?.length || 0} arquivos`} para {displayName}</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-3 gap-2 max-h-[45vh] overflow-y-auto styled-scrollbar">
                        {(previa || []).map((f, i) => (
                            <MiniaturaArquivo key={`${f.name}-${i}`} arquivo={f} onRemover={enviandoPrevia ? undefined : () => setPrevia((l) => (l || []).filter((_, j) => j !== i))} />
                        ))}
                    </div>
                    <Textarea placeholder="Legenda (opcional — vai na primeira foto/vídeo)" value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={2}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarPrevia(); } }}
                        className="resize-none text-sm" disabled={enviandoPrevia} />
                    <div className="flex justify-end -mt-1">
                        <CorretorTexto texto={legenda} aoAplicar={setLegenda} rotulo disabled={enviandoPrevia} />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-muted-foreground">
                        <Checkbox checked={comoDocumento} onCheckedChange={(v) => setComoDocumento(!!v)} disabled={enviandoPrevia} />
                        Enviar como documento (qualidade original, sem compressão)
                    </label>
                    <div className="flex justify-between gap-2">
                        <Button variant="ghost" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.onchange = () => abrirPrevia(Array.from(i.files || [])); i.click(); }} disabled={enviandoPrevia}>
                            <Paperclip className="h-4 w-4 mr-1.5" /> Adicionar mais
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => { setPrevia(null); setLegenda(""); }} disabled={enviandoPrevia}>Cancelar</Button>
                            <Button onClick={enviarPrevia} disabled={enviandoPrevia}>
                                <Send className="h-4 w-4 mr-1.5" /> {enviandoPrevia ? "Enviando..." : "Enviar"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation dialog */}
            <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("deleteDescription")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const msg = deleteConfirmMsg;
                                if (!msg) return;
                                // minha versao: apaga no WhatsApp de verdade; o conteudo fica so na Auditoria
                                fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/${msg.keyId}`, { method: "DELETE" })
                                    .then(async (r) => {
                                        const d = await r.json().catch(() => ({}));
                                        if (!r.ok || d?.status === false) throw new Error(d?.message || tCommon("error"));
                                        setMessages(p => p.filter(m => m.keyId !== msg.keyId));
                                        if (d?.modo === "PARA_MIM") toast.info("Apagada só para você", { description: "Mensagem de outra pessoa: o WhatsApp não deixa apagar para todos. Ficou registrada na Auditoria." });
                                        else toast.success("Mensagem apagada para todos", { description: "O conteúdo ficou registrado na Auditoria." });
                                    })
                                    .catch((e) => toast.error(e?.message || tCommon("error")));
                                setDeleteConfirmMsg(null);
                            }}
                        >{t("delete")}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Loading older indicator */}
            {loadingMore && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border text-xs flex items-center gap-2">
                    <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    {t("loadingOlder")}
                </div>
            )}

            {/* Header */}
            <div className="shrink-0 px-3 py-2.5 border-b bg-background/80 backdrop-blur-sm flex items-center gap-3 z-10">
                {onBack && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0 text-muted-foreground hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                )}
                {/* minha versao: clicar no cabeçalho abre os dados do contato/grupo */}
                <button type="button" onClick={() => setInfoOpen(true)} title={isGroup ? "Dados do grupo" : "Dados do contato"}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-muted/40 transition-colors cursor-pointer">
                    <Avatar className="h-9 w-9 shrink-0">
                        {chatPic && <AvatarImage src={chatPic} alt={displayName} />}
                        <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-primary/20 to-primary/10 text-foreground">
                            {displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{displayName}</h3>
                        <p className="text-[10px] text-muted-foreground truncate">
                            {isGroup ? (participants.length ? `${participants.length} membros · clique para ver o grupo` : "clique para ver os dados do grupo") : "clique para ver os dados do contato"}
                        </p>
                    </div>
                </button>
                {/* minha versao: tamanho do texto da conversa */}
                <div className="flex items-center shrink-0 rounded-lg border border-border/50 overflow-hidden" title={`Tamanho do texto: ${Math.round(escala * 100)}%`}>
                    <button type="button" onClick={() => mudarEscala(-0.1)} disabled={escala <= ESCALA_MIN}
                        className="h-8 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">A−</button>
                    <button type="button" onClick={() => mudarEscala(0, 1.25)}
                        className="h-8 px-1 text-[10px] tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer" title="Voltar ao padrão (125%)">{Math.round(escala * 100)}%</button>
                    <button type="button" onClick={() => mudarEscala(+0.1)} disabled={escala >= ESCALA_MAX}
                        className="h-8 px-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">A+</button>
                </div>
                {/* minha versao: procurar na conversa */}
                <Button variant="ghost" size="icon" className={cn("h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground", buscaAberta && "bg-muted text-foreground")} onClick={() => { setBuscaAberta((o) => !o); setBuscaQ(""); setBuscaResultados([]); setBuscaTotal(0); }} title="Procurar na conversa">
                    <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setInfoOpen((o) => !o)} title="Informações">
                    <Info className="h-4 w-4" />
                </Button>
            </div>

            {/* minha versao: painel de busca na conversa (lupa) */}
            {buscaAberta && (
                <div className="shrink-0 border-b bg-background/95 flex flex-col max-h-[45%]">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input autoFocus value={buscaQ} onChange={(e) => setBuscaQ(e.target.value)}
                            placeholder="Procurar nesta conversa…" className="h-8 border-0 bg-muted/50 focus-visible:ring-1"
                            onKeyDown={(e) => { if (e.key === "Escape") { setBuscaAberta(false); } }} />
                        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                            {buscando ? "…" : buscaQ.trim().length >= 2 ? `${buscaTotal}` : ""}
                        </span>
                        <button type="button" className="p-1 text-muted-foreground hover:text-foreground shrink-0" title="Fechar busca"
                            onClick={() => { setBuscaAberta(false); setBuscaQ(""); setBuscaResultados([]); }}>
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    {buscaQ.trim().length >= 2 && (
                        <div className="overflow-y-auto styled-scrollbar border-t">
                            {buscaResultados.length === 0 && !buscando ? (
                                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma mensagem encontrada.</p>
                            ) : (
                                buscaResultados.map((r) => {
                                    const quem = r.fromMe ? "Você" : (r.senderName || r.pushName || (isGroup ? "Membro" : displayName));
                                    return (
                                        <button key={r.keyId} type="button" onClick={() => pularParaResultado(r.keyId)}
                                            className="w-full text-left px-3 py-2 border-b border-border/10 hover:bg-muted/40 transition-colors cursor-pointer">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-[11px] font-semibold text-primary truncate">{quem}</span>
                                                <span className="text-[10px] text-muted-foreground shrink-0">{new Date(r.timestamp).toLocaleString()}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate">{realcar(r.content || "", buscaQ.trim())}</p>
                                        </button>
                                    );
                                })
                            )}
                            {buscaTotal > buscaResultados.length && (
                                <p className="text-[10px] text-muted-foreground text-center py-2">Mostrando os {buscaResultados.length} mais recentes de {buscaTotal}. Refine a busca.</p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* minha versao: mensagem fixada na conversa (clique vai ate ela; com varias, alterna entre elas) */}
            {fixadas.length > 0 && (() => {
                const f = fixadas[Math.min(fixadaIdx, fixadas.length - 1)];
                const previa = f.content?.trim() || (f.type === "IMAGE" ? "📷 Foto" : f.type === "VIDEO" ? "🎥 Vídeo" : f.type === "AUDIO" ? "🎤 Áudio" : f.type === "DOCUMENT" ? "📄 Documento" : f.type ? "Mensagem" : "Mensagem que não está salva no painel");
                return (
                    <button type="button" className="shrink-0 border-b bg-background/80 px-3 py-1.5 flex items-center gap-2.5 text-left hover:bg-muted/40 cursor-pointer"
                        title={fixadas.length > 1 ? "Clique para ir até a mensagem e passar para a próxima fixada" : "Clique para ir até a mensagem"}
                        onClick={() => {
                            const alvo = document.getElementById(`msg-${f.keyId}`);
                            if (alvo) {
                                alvo.scrollIntoView({ behavior: "smooth", block: "center" });
                                alvo.classList.add("ring-2", "ring-primary", "rounded-xl");
                                setTimeout(() => alvo.classList.remove("ring-2", "ring-primary", "rounded-xl"), 1500);
                            } else {
                                toast.info("Essa mensagem é mais antiga que as carregadas. Role a conversa para cima para carregar.");
                            }
                            if (fixadas.length > 1) setFixadaIdx((i) => (i + 1) % fixadas.length);
                        }}>
                        <Pin className="h-3.5 w-3.5 shrink-0 text-primary rotate-45" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold text-primary">
                                Mensagem fixada{fixadas.length > 1 ? ` ${Math.min(fixadaIdx, fixadas.length - 1) + 1} de ${fixadas.length}` : ""}{f.por ? ` · por ${f.por}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{previa}</p>
                        </div>
                    </button>
                );
            })()}

            {foraAgenda && (
                <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs">
                    {addNome === null ? (
                        <div className="flex items-center gap-2">
                            <BookUser className="h-4 w-4 text-amber-500 shrink-0" />
                            <span className="flex-1 text-muted-foreground">Este número não está na sua agenda.</span>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddNome(foraAgenda.sugestao)}>
                                <UserPlus className="h-3.5 w-3.5" /> Adicionar à agenda
                            </Button>
                            <button className="p-1 text-muted-foreground hover:text-foreground" title="Ocultar" onClick={() => setForaAgenda(null)}><X className="h-3.5 w-3.5" /></button>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2">
                            <Input autoFocus value={addNome} onChange={(e) => setAddNome(e.target.value)} placeholder="Nome do contato"
                                onKeyDown={(e) => { if (e.key === "Enter") salvarNaAgenda(); if (e.key === "Escape") setAddNome(null); }}
                                className="h-8 text-sm flex-1 min-w-[160px]" />
                            {foraAgenda.alvo.endsWith("@s.whatsapp.net") && (
                                <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
                                    <Checkbox checked={addCelular} onCheckedChange={(v) => setAddCelular(!!v)} className="h-3.5 w-3.5" /> também no celular
                                </label>
                            )}
                            <Button size="sm" className="h-8" disabled={salvandoContato || !addNome.trim()} onClick={salvarNaAgenda}>{salvandoContato ? "Salvando…" : "Salvar"}</Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => setAddNome(null)}>Cancelar</Button>
                        </div>
                    )}
                </div>
            )}

            {/* minha versao: salvar / conversar com contato encaminhado (confere o numero no WhatsApp) */}
            <NovaConversaDialog sessionId={sessionId} open={!!dlgContato} onOpenChange={(v) => { if (!v) setDlgContato(null); }}
                modo={dlgContato?.modo || "numero"} inicial={dlgContato ? { numero: dlgContato.numero, nome: dlgContato.nome } : undefined}
                onAbrir={(j, n) => onOpenChat?.(j, n)} />

            {infoOpen && <ChatInfoPanel sessionId={sessionId} jid={jid} onClose={() => setInfoOpen(false)} onOpenChat={onOpenChat} />}

            {/* Lightbox: clicar na imagem abre em tela cheia (minha versao) */}
            {/* minha versao: visualizador com zoom, arrastar, girar e anterior/proxima (as fotos desta conversa) */}
            {lightbox && (
                <VisualizadorImagem src={lightbox} imagens={fotosDaConversa}
                    onFechar={() => setLightbox(null)} onTrocar={setLightbox}
                    onBaixar={(src) => { const m = messages.find((x) => x.mediaUrl === src); handleDownload(src, nomeParaDownload(m || { type: "IMAGE", mediaUrl: src })); }} />
            )}

            {/* Messages */}
            <div ref={scrollRef} className="chat-fundo flex-1 overflow-y-auto px-3 sm:px-4 py-3 min-h-0 styled-scrollbar" onScroll={handleScroll}>
                {/* minha versao: ocupa a largura toda (antes max-w-3xl centralizado: as enviadas paravam no meio da tela) */}
                {/* minha versao: tamanho da conversa (A-/A+ no cabecalho) — zoom so nesta area */}
                <div className="flex flex-col gap-3" style={{ zoom: escala }}>
                    {loading && messages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center py-32">
                            <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        </div>
                    )}
                    {!hasMore && messages.length > 0 && (
                        <div className="text-center py-4">
                            <span className="text-[10px] font-medium text-muted-foreground bg-background/80 px-3 py-1 rounded-full border border-border/30">{t("beginningOfConversation")}</span>
                        </div>
                    )}
                    {messages.length === 0 && !loading && (
                        <div className="flex-1 flex items-center justify-center py-16"><p className="text-sm text-muted-foreground">{t("noMessages")}</p></div>
                    )}
                    {messages.map((msg, idx) => {
                        const showDate = idx === 0 || getDateLabel(msg.timestamp) !== getDateLabel(messages[idx - 1].timestamp);
                        // grupo: foto so na primeira de uma sequencia da mesma pessoa (igual WhatsApp)
                        const prevMsg = idx > 0 ? messages[idx - 1] : null;
                        const inicioSequencia = !prevMsg || showDate || prevMsg.fromMe || prevMsg.senderJid !== msg.senderJid;
                        return (
                            <div key={msg.keyId} id={`msg-${msg.keyId}`} className={novasRef.current.has(msg.keyId) ? "msg-entrar" : undefined}>
                                {showDate && (
                                    <div className="flex justify-center my-3">
                                        <span className="text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-border/30">
                                            {getDateLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                )}
                                <div className={cn("flex gap-1 group", msg.fromMe ? "justify-end" : "justify-start")}>
                                    {/* Reply button: my msg on left */}
                                    {msg.fromMe && (
                                        <div className="self-center flex items-center shrink-0 order-first">
                                            <BotaoReagir minha={msg.reacoes?.["eu"]?.e} onEscolher={(e) => reagir(msg, e)} />
                                            <button onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                                className="p-1.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded-lg transition-all opacity-40 group-hover:opacity-100 cursor-pointer shrink-0"
                                                title="Responder">
                                                <CornerUpLeft className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}
                                    {!msg.fromMe && isGroup && (
                                        inicioSequencia ? (
                                            <FotoMembro sessionId={sessionId} jid={msg.senderJid} nome={nomeAutor(msg)}
                                                onClick={() => {
                                                    const p = participants.find((x) => x.id === msg.senderJid);
                                                    const alvo = p?.phone ? `${p.phone}@s.whatsapp.net` : msg.senderJid;
                                                    if (alvo && onOpenChat) onOpenChat(alvo, nomeAutor(msg));
                                                }} />
                                        ) : <span className="w-8 shrink-0" />
                                    )}
                                    <div className={cn("flex flex-col min-w-0 max-w-[85%] sm:max-w-[70%]", msg.fromMe ? "items-end" : "items-start")}>
                                    <div className={cn(
                                        "flex flex-col max-w-full rounded-2xl px-3 py-2 shadow-sm overflow-hidden cursor-context-menu",
                                        msg.fromMe ? "bolha-out rounded-br-sm" : "bolha-in text-foreground border border-border/40 rounded-bl-sm"
                                    )} onContextMenu={(e) => handleContextMenu(e, msg)}>
                                        {!msg.fromMe && isGroup && inicioSequencia && (
                                            <span className="text-[10px] font-semibold text-primary block mb-0.5">{nomeAutor(msg)}</span>
                                        )}
                                        {msg.fromMe && msg.sentBy && (
                                            <span className="text-[11px] font-semibold text-primary-foreground/75 block mb-0.5">{msg.sentBy}</span>
                                        )}
                                        {/* minha versao: enviada FORA da plataforma (celular/outro aparelho) ou pelo sistema (API/bot/agendador) */}
                                        {msg.fromMe && !msg.sentBy && msg.origemEnvio === "FORA" && (
                                            <span className="text-[11px] font-semibold block mb-0.5 opacity-70" title="Enviada pelo celular ou por outro aparelho conectado, não pela plataforma">
                                                📱 Fora da plataforma
                                            </span>
                                        )}
                                        {msg.fromMe && !msg.sentBy && msg.origemEnvio === "PLATAFORMA" && (
                                            <span className="text-[11px] font-semibold text-primary-foreground/75 block mb-0.5" title="Enviada pelo sistema: API, bot, resposta automática, agendamento ou disparo">
                                                ⚙️ Sistema
                                            </span>
                                        )}
                                        {/* minha versao: encaminhada (4+ vezes = "com frequencia", como no WhatsApp) */}
                                        {msg.extra?.encaminhada && (
                                            <span className={cn("flex items-center gap-1 text-[11px] italic mb-0.5", msg.fromMe ? "text-primary-foreground/75" : "text-muted-foreground")}>
                                                <Forward className="h-3 w-3 shrink-0" />
                                                {msg.extra.encaminhada.vezes >= 4 ? "Encaminhada com frequência" : "Encaminhada"}
                                            </span>
                                        )}
                                        {msg.quoted && (
                                            <div
                                                className={cn(
                                                    "mb-1.5 px-2 py-1 rounded-lg border-l-4 text-xs select-none cursor-pointer text-left bg-muted/40",
                                                    msg.fromMe 
                                                        ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground/90 hover:bg-primary-foreground/15" 
                                                        : "border-primary bg-muted text-muted-foreground hover:bg-muted/60"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const target = document.getElementById(`msg-${msg.quoted?.keyId}`);
                                                    if (target) {
                                                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                                                        target.classList.add("bg-primary/10", "transition-colors", "duration-500");
                                                        setTimeout(() => {
                                                            target.classList.remove("bg-primary/10");
                                                        }, 1500);
                                                    } else {
                                                        toast.info("A mensagem original não está carregada na tela (role para cima)");
                                                    }
                                                }}
                                            >
                                                <span className="font-semibold block text-[10px]">
                                                    {nomeAutor(msg.quoted)}
                                                </span>
                                                <span className="line-clamp-2 block break-all text-xs">
                                                    {(isGroup ? renderText(msg.quoted.content) : msg.quoted.content) || "Mídia"}
                                                </span>
                                            </div>
                                        )}
                                        {/* IMAGE */}
                                        {msg.type === 'IMAGE' && msg.mediaUrl && (
                                            <div className="relative group/media">
                                                <LazyMedia key={msg.mediaUrl} src={msg.mediaUrl} alt="Image" onClick={() => setLightbox(msg.mediaUrl!)} />
                                                <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))}><Download className="h-4 w-4" /></Button>
                                            </div>
                                        )}
                                        {/* VIDEO */}
                                        {msg.type === 'VIDEO' && msg.mediaUrl && (
                                            <div className="relative group/media">
                                                <LazyVideo src={msg.mediaUrl} onBaixar={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))} />
                                                <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm z-10"
                                                    onClick={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))}><Download className="h-4 w-4" /></Button>
                                            </div>
                                        )}
                                        {/* AUDIO */}
                                        {msg.type === 'AUDIO' && msg.mediaUrl && (
                                            <ReprodutorAudio src={msg.mediaUrl} fromMe={msg.fromMe} keyId={msg.keyId}
                                                onBaixar={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))} />
                                        )}
                                        {/* STICKER */}
                                        {msg.type === 'STICKER' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1">
                                                <img src={msg.mediaUrl} alt="Sticker" className="max-h-32 object-contain rounded-lg" loading="lazy" />
                                                <Button size="icon" variant="secondary" className="absolute -top-1 -right-1 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))}><Download className="h-3 w-3" /></Button>
                                            </div>
                                        )}
                                        {/* CONTATO encaminhado (minha versao) */}
                                        {msg.type === 'CONTACT' && (
                                            (msg.extra?.contatos?.length ? msg.extra.contatos : [{ nome: msg.content || "Contato", numeros: [] }]).map((c, ci) => (
                                                <CartaoContato key={ci} c={c} fromMe={msg.fromMe}
                                                    onConversar={(n, nm) => {
                                                        if (n.waid) onOpenChat?.(`${n.waid}@s.whatsapp.net`, nm);
                                                        else setDlgContato({ numero: n.texto, nome: nm, modo: "numero" }); // confere no WhatsApp antes
                                                    }}
                                                    onSalvar={(n, nm) => setDlgContato({ numero: n.waid ? "+" + n.waid : n.texto, nome: nm, modo: "numero" })} />
                                            ))
                                        )}
                                        {/* minha versao: midia sem arquivo ainda (baixando, ou falhou com botao de tentar de novo) */}
                                        {["IMAGE", "VIDEO", "AUDIO", "STICKER", "DOCUMENT"].includes(msg.type) && !msg.mediaUrl && !(msg.extra as any)?.apagada && <MidiaPendente msg={msg} sessionId={sessionId} />}
                                        {/* DOCUMENT */}
                                        {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && msg.type !== 'CONTACT' && (
                                            <div className={cn("flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg mb-1", msg.fromMe ? "bg-black/5 dark:bg-white/10" : "bg-muted/50")}>
                                                <div className="flex items-center gap-2 truncate min-w-0">
                                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                                    <span className="text-xs font-medium truncate" title={msg.type === "DOCUMENT" && msg.content ? msg.content : undefined}>{msg.type === "DOCUMENT" && msg.content ? msg.content : `${msg.type} Message`}</span>
                                                </div>
                                                {msg.mediaUrl && <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full shrink-0" onClick={() => handleDownload(msg.mediaUrl!, nomeParaDownload(msg))}><Download className="h-3.5 w-3.5" /></Button>}
                                            </div>
                                        )}
                                        {/* Interactive Response Badge */}
                                        {(msg.content?.includes("[Interactive Response]") || msg.content?.includes("[Button Response]") || msg.content?.includes("[List Response]") || msg.content?.includes("[Button Reply]")) && (
                                            <div className="mb-1">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                                                    msg.fromMe ? "bg-black/5 dark:bg-white/15 text-primary-foreground" : "bg-primary/10 text-foreground border border-primary/20"
                                                )}>
                                                    <Sparkles className="h-2.5 w-2.5" /> {t("buttonClicked")}
                                                </span>
                                            </div>
                                        )}
                                        {/* minha versao: previa do primeiro link (a que veio com a mensagem ou pedida ao servidor) */}
                                        {msg.type === 'TEXT' && !(msg.extra as any)?.apagada && (
                                            <PreviaLinkCartao previa={msg.extra?.previa} texto={msg.content} fromMe={msg.fromMe} />
                                        )}
                                        {/* Text */}
                                        <div className="flex items-end gap-2 min-w-0">
                                            {/* minha versao: min-w-0 + overflow-wrap:anywhere -> link comprido quebra dentro do balao */}
                                            <span className={cn("flex-1 min-w-0 text-sm break-words [overflow-wrap:anywhere] whitespace-pre-wrap", (msg.extra as any)?.apagada && "italic opacity-70")}
                                                title={(msg.extra as any)?.apagada ? `Apagada por ${(msg.extra as any)?.por || "?"} — o conteúdo está na Auditoria` : undefined}>
                                                {msg.type === 'CONTACT' ? null : <TextoComLinks texto={isGroup ? renderText(semAssinatura(msg)) : semAssinatura(msg)} fromMe={msg.fromMe} />}
                                            </span>
                                            <span className={cn("text-[9px] shrink-0 leading-none flex items-center gap-0.5", msg.fromMe ? "text-primary-foreground/75" : "text-muted-foreground")}>
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                {msg.fromMe && <Tiques status={msg.status} className={msg.status === "READ" ? "text-primary" : "text-primary-foreground/60"} />}
                                            </span>
                                        </div>
                                    </div>
                                    <ReacoesMsg reacoes={msg.reacoes} fromMe={msg.fromMe} onClique={(e) => reagir(msg, e)} />
                                    </div>
                                    {/* Reply button: other msg on right */}
                                    {!msg.fromMe && (
                                        <div className="self-center flex items-center shrink-0">
                                            <button onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                                className="p-1.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded-lg transition-all opacity-40 group-hover:opacity-100 cursor-pointer shrink-0"
                                                title={t("reply")}>
                                                <CornerUpLeft className="h-3.5 w-3.5" />
                                            </button>
                                            <BotaoReagir minha={msg.reacoes?.["eu"]?.e} onEscolher={(e) => reagir(msg, e)} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* New message badge */}
            {newMsgBadge && !janelaBusca && (
                <button onClick={() => { scrollToBottom(true); setNewMsgBadge(false); }}
                    className="absolute bottom-[90px] right-6 z-20 flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-bounce">
                    <ArrowDown className="h-4 w-4" /> {t("newMessagesBadge")}
                </button>
            )}

            {/* minha versao: vendo um resultado antigo da busca -> voltar para o fim (mensagens ao vivo) */}
            {janelaBusca && (
                <button onClick={voltarAoFim}
                    className="absolute bottom-[90px] right-6 z-20 flex items-center gap-2 rounded-full bg-foreground px-3 py-2 text-xs font-semibold text-background shadow-lg hover:opacity-90 transition-all">
                    <ArrowDown className="h-4 w-4" /> Voltar ao fim
                </button>
            )}

            {/* Input */}
            <div className="shrink-0 px-3 py-2.5 bg-background/80 backdrop-blur-sm border-t" style={{ zoom: Math.min(escala, 1.3) }}>
                <div className="flex items-center gap-2 w-full">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"><Paperclip className="h-4.5 w-4.5" /></Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-1.5" side="top" align="start">
                            <div className="flex flex-col gap-0.5">
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('image')}><ImageIcon className="h-3.5 w-3.5 text-chart-1" /> {t("image")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('video')}><Video className="h-3.5 w-3.5 text-chart-3" /> {t("video")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('audio')}><Music className="h-3.5 w-3.5 text-chart-4" /> {t("audio")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('document')}><FileText className="h-3.5 w-3.5 text-chart-5" /> {t("document")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('sticker')}><Sticker className="h-3.5 w-3.5 text-chart-2" /> Figurinha</Button>
                                <div className="my-1 border-t border-border/30" />
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs text-primary hover:text-primary hover:bg-primary/10 font-medium" onClick={() => setInteractiveDialogOpen(true)}>
                                    <Sparkles className="h-3.5 w-3.5 text-primary" /> {t("interactiveAndTest")}
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full shrink-0 text-primary/80 hover:text-primary hover:bg-primary/10"
                        title={t("interactiveTitle")}
                        onClick={() => setInteractiveDialogOpen(true)}
                    >
                        <Sparkles className="h-4.5 w-4.5" />
                    </Button>

                    <div className="flex-1 relative">
                        {/* minha versao: popup de @mencao (membros do grupo) */}
                        {mentionQuery !== null && mentionCandidates.length > 0 && (
                            <div className="absolute bottom-full mb-2 left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-xl border border-border/60 bg-popover shadow-xl p-1 styled-scrollbar">
                                <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Mencionar · ↑↓ e Enter</p>
                                {mentionCandidates.map((p, i) => (
                                    <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}
                                        className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm cursor-pointer", i === mentionIndex ? "bg-primary/15 text-foreground" : "hover:bg-muted")}>
                                        <span className="h-7 w-7 rounded-full bg-primary/15 text-foreground text-[10px] font-semibold flex items-center justify-center shrink-0">
                                            {(p.name || p.phone || "?").slice(0, 2).toUpperCase()}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block truncate">{p.name || formatarTelefone(p.phone) || "Membro (número oculto)"}</span>
                                            {p.name && p.phone && <span className="block text-[10px] text-muted-foreground">{formatarTelefone(p.phone)}</span>}
                                        </span>
                                        {p.admin && <span className="text-[9px] font-semibold text-primary">ADMIN</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                        {/* Reply preview bar */}
                        {replyingTo && (
                            <div className="mb-2 flex items-start gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border-l-2 border-primary text-xs animate-in slide-in-from-bottom-1 overflow-hidden">
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <span className="font-semibold text-foreground block text-[10px]">{t("replyingTo", { name: nomeAutor(replyingTo) })}</span>
                                    <span className="text-muted-foreground truncate block w-full">{replyingTo.content || `[${replyingTo.type}]`}</span>
                                </div>
                                <button onClick={() => setReplyingTo(null)} className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                        )}
                        <div className="flex items-end gap-2 p-1 rounded-2xl border border-border/30 bg-background">
                            <textarea ref={inputRef} value={input} onChange={handleInputChange} onPaste={aoColar}
                                onKeyDown={handleKeyDown} placeholder={isGroup ? "Digite uma mensagem — use @ para mencionar" : t("typePlaceholder")} rows={1} style={{ minHeight: "36px", maxHeight: "120px" }}
                                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none leading-normal" />
                        </div>
                    </div>

                    {/* minha versao: corretor ortografico offline (pt-BR) */}
                    <CorretorTexto texto={input} aoAplicar={setInput} className="h-9 w-9 rounded-full" />

                    <Button type="button" variant="ghost" size="icon"
                        onClick={() => { const v = !assinar; setAssinar(v); salvarAlertas({ [chaveAssinar]: v }); toast.info(v ? `Assinando ${isGroup ? "nos grupos" : "nas conversas privadas"}: seu nome vai em negrito em cima da mensagem` : `Assinatura desligada ${isGroup ? "nos grupos" : "nas conversas privadas"}`); }}
                        className={cn("h-9 w-9 rounded-full shrink-0", assinar ? "text-primary bg-primary/15 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground")}
                        title={assinar ? "Assinatura ligada: vai *Seu Nome* e a mensagem embaixo" : "Assinar mensagens (o cliente vê seu nome)"}>
                        <PenLine className="h-4 w-4" />
                    </Button>
                    {/* minha versao: microfone SEMPRE visivel (gravar voz); o botao enviar aparece quando ha texto */}
                    <GravadorVoz onEnviar={enviarVoz} />
                    {input.trim() && <Button onClick={handleSend} size="icon" className="h-9 w-9 rounded-full shrink-0"><Send className="h-4 w-4" /></Button>}
                </div>
            </div>

            {/* Interactive Message & Test Trigger Dialog */}
            <InteractiveMessageDialog
                open={interactiveDialogOpen}
                onOpenChange={setInteractiveDialogOpen}
                sessionId={sessionId}
                jid={jid}
                recipientName={displayName}
                onSuccess={() => {
                    setTimeout(() => fetchMessages(), 600);
                }}
            />
        </div>
    );
}
