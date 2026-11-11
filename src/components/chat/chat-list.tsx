"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Search, MessageCircle, X, Tag, MoreHorizontal, CornerUpLeft, Trash2, Info, Check, BookUser, CheckCheck, Clock3, AlertCircle, Mail, MailOpen, Pin, PinOff, BellOff, Bell, Archive, ArchiveRestore, ChevronLeft } from "lucide-react";
import { NovaConversaDialog, normalizarNumero } from "./nova-conversa";
import { formatarTelefone } from "./chat-info-panel";
import { deixarArquivos, temArquivos } from "@/lib/arquivos-pendentes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getChatsStatus, marcarConversaNaoLida, marcarConversaLida, buscarGeralChats } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { ChatListFilter } from "@/modules/whatsapp/chat.service";

interface ChatContact {
    jid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    unread?: number; // minha versao: mensagens novas (nao lidas no painel)
    naoLida?: boolean; // minha versao: "marcar como nao lida"
    // minha versao: estado espelhado do WhatsApp (celular e painel)
    arquivada?: boolean;
    silenciada?: boolean;
    silenciadaAte?: string | null;
    fixada?: boolean;
    fixadaEm?: string | null;
    lastMessage?: {
        content: string | null;
        timestamp: string;
        type: string;
        fromMe?: boolean;
        status?: string;
        keyId?: string;
    };
}

// minha versao: status da minha ultima mensagem — ✓ enviada, ✓✓ entregue, ✓✓ azul lida
export function Tiques({ status, className }: { status?: string; className?: string }) {
    if (status === "PENDING") return <Clock3 className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} aria-label="Enviando" />;
    if (status === "FAILED") return <AlertCircle className={cn("h-3.5 w-3.5 shrink-0 text-destructive", className)} aria-label="Falhou" />;
    if (status === "DELIVERED" || status === "READ") {
        const lida = status === "READ";
        return <CheckCheck className={cn("h-4 w-4 shrink-0", lida ? "text-primary" : "text-muted-foreground", className)} aria-label={lida ? "Lida" : "Entregue"} />;
    }
    return <Check className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} aria-label="Enviada" />;
}

interface LabelData {
    id: string;
    name: string;
    colorHex: string;
}

interface ChatListProps {
    sessionId: string;
    onSelectChat: (jid: string, name?: string) => void;
    selectedJid?: string;
}

const PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "50", 10);

const FILTER_STORAGE_KEY = "chat-list-filter";
const FILTER_OPTIONS: { value: ChatListFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "private", label: "Chats" },
    { value: "groups", label: "Groups" },
    { value: "archived", label: "Arquivadas" },
];

// minha versao: fixadas no topo (a mais recente primeiro), depois pela ultima mensagem
function ordenarConversas(a: ChatContact, b: ChatContact) {
    if (!!a.fixada !== !!b.fixada) return a.fixada ? -1 : 1;
    if (a.fixada && b.fixada) return new Date(b.fixadaEm || 0).getTime() - new Date(a.fixadaEm || 0).getTime();
    const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
    const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
    return tB - tA;
}

// minha versao: arquivar / silenciar / fixar pelo painel (vai para o WhatsApp e fica guardado)
async function alterarConversa(sessionId: string, jid: string, acao: "pin" | "mute" | "archive", body: any) {
    const r = await fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/${acao}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.status === false) throw new Error(d?.message || "Não consegui alterar a conversa");
    return d?.data;
}

function readStoredFilter(): ChatListFilter {
    try {
        const stored = localStorage.getItem(FILTER_STORAGE_KEY);
        if (FILTER_OPTIONS.some(o => o.value === stored)) return stored as ChatListFilter;
    } catch { /* storage unavailable */ }
    return "all";
}

// Client-side mirror of the SQL filter in ChatService.getChatsList (used for realtime updates)
function matchesFilter(jid: string, filter: ChatListFilter): boolean {
    if (jid.endsWith("@broadcast")) return false;
    const isGroup = jid.endsWith("@g.us");
    if (filter === "groups") return isGroup;
    if (filter === "private") return !isGroup && !jid.endsWith("@newsletter");
    return true; // "all" e "archived" (o arquivado e conferido pela flag que vem com a mensagem)
}

// cache de fotos buscadas por linha (a lista e virtualizada, entao so busca as visiveis)
const picCache = new Map<string, string | null>();

function getDisplayName(chat: ChatContact): string {
    if (chat.name) return chat.name;
    if (chat.notify) return chat.notify;
    if (chat.jid.endsWith("@s.whatsapp.net") || chat.jid.endsWith("@g.us")) return chat.jid.split('@')[0];
    return "Contato"; // @lid sem nome -> evita mostrar o numero aleatorio do LID
}

// minha versao: midia sem legenda caia em "No messages yet"; agora mostra o tipo (e a legenda, se houver)
const TIPO_PREVIA: Record<string, string> = {
    IMAGE: "📷 Foto",
    VIDEO: "🎥 Vídeo",
    AUDIO: "🎤 Áudio",
    DOCUMENT: "📄 Documento",
    STICKER: "🌟 Figurinha",
    LOCATION: "📍 Localização",
    CONTACT: "👤 Contato",
};

function getMessagePreview(chat: ChatContact): string {
    if (!chat.lastMessage) return "Sem mensagens";
    const { type } = chat.lastMessage;
    const content = (chat.lastMessage.content || "").replace(/\s+/g, " ").trim();
    const corta = (s: string) => (s.length > 40 ? s.slice(0, 40) + "…" : s);
    if (type !== "TEXT") {
        const rotulo = TIPO_PREVIA[type] || "📎 Anexo";
        if (!content || type === "LOCATION") return rotulo;
        return corta(`${rotulo.split(" ")[0]} ${content}`);
    }
    return content ? corta(content) : "Mensagem";
}

function getTimeLabel(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) {
        // minha versao: "Ontem"/"Yesterday" no idioma do navegador (como as outras datas desta lista)
        const ontem = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "day");
        return ontem.charAt(0).toUpperCase() + ontem.slice(1);
    }
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Etiquetas (diálogo pelo clique direito) ──────
// minha versao: etiquetas num diálogo (aberto pelo clique direito na conversa), não mais botão na linha
function LabelAssignDialog({ sessionId, jid, nome, open, onOpenChange }: { sessionId: string; jid: string; nome: string; open: boolean; onOpenChange: (v: boolean) => void }) {
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [assigned, setAssigned] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    const fetchLabels = useCallback(async () => {
        setLoading(true);
        try {
            const [labelRes, assignedRes] = await Promise.all([
                fetch(`/api/labels/${sessionId}`),
                fetch(`/api/labels/${sessionId}/chats?jid=${encodeURIComponent(jid)}`)
            ]);
            const labelData = await labelRes.json();
            const assignedData = await assignedRes.json();

            if (labelRes.ok) setLabels(labelData.data?.labels || []);
            if (assignedRes.ok) {
                setAssigned(new Set((assignedData.data || []).map((cl: any) => cl.labelId)));
            }
        } catch (e) {
            console.error("Failed to fetch labels", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId, jid]);

    useEffect(() => {
        if (open) fetchLabels();
    }, [open, fetchLabels]);

    const toggleLabel = async (labelId: string) => {
        const isAssigned = assigned.has(labelId);
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: isAssigned ? "remove" : "add" })
            });
            if (res.ok) {
                setAssigned(prev => {
                    const next = new Set(prev);
                    isAssigned ? next.delete(labelId) : next.add(labelId);
                    return next;
                });
                toast.success(isAssigned ? "Etiqueta removida" : "Etiqueta aplicada");
            }
        } catch (e) {
            toast.error("Falha ao atualizar a etiqueta");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xs" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base"><Tag className="h-4 w-4 text-primary" /> Etiquetas</DialogTitle>
                    <DialogDescription className="truncate">{nome}</DialogDescription>
                </DialogHeader>
                {loading ? (
                    <div className="flex items-center justify-center py-6"><Skeleton className="h-4 w-24" /></div>
                ) : labels.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma etiqueta. Crie em <b>Etiquetas</b>, no menu.</p>
                ) : (
                    <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
                        {labels.map(label => (
                            <button key={label.id} onClick={() => toggleLabel(label.id)}
                                className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm hover:bg-muted transition-colors cursor-pointer text-left">
                                <div className={cn(
                                    "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                    assigned.has(label.id) ? "border-primary bg-primary/10" : "border-muted-foreground/30"
                                )}>
                                    {assigned.has(label.id) && <Check className="h-3 w-3 text-primary" />}
                                </div>
                                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: label.colorHex }} />
                                <span className="truncate font-medium">{label.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── Context Menu ──────────────────
interface CtxMenuState { x: number; y: number; jid: string; name: string; marcadaNova: boolean; fixada: boolean; silenciada: boolean; arquivada: boolean; }
function ChatContextMenu({ state, onClose, sessionId, onSelect, onAlternarLida, onEtiquetas }: { state: CtxMenuState; onClose: () => void; sessionId: string; onSelect: (jid: string, name?: string) => void; onAlternarLida: (jid: string, naoLida: boolean) => void; onEtiquetas: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [submenu, setSubmenu] = useState<"silenciar" | null>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [onClose]);

    // a lista se atualiza pelo evento "chat.estado" que o servidor manda depois de gravar
    const alterar = (acao: "pin" | "mute" | "archive", body: any, ok: string) => {
        onClose();
        alterarConversa(sessionId, state.jid, acao, body).then(() => toast.success(ok)).catch((e: any) => toast.error(e?.message || "Não consegui alterar a conversa"));
    };

    const items = submenu === "silenciar" ? [
        { label: "Voltar", icon: ChevronLeft, action: () => setSubmenu(null) },
        { label: "Por 8 horas", icon: BellOff, action: () => alterar("mute", { mute: true, duration: 8 * 3600 }, "Silenciada por 8 horas") },
        { label: "Por 1 semana", icon: BellOff, action: () => alterar("mute", { mute: true, duration: 7 * 86400 }, "Silenciada por 1 semana") },
        { label: "Sempre", icon: BellOff, action: () => alterar("mute", { mute: true, duration: -1 }, "Silenciada") },
    ] : [
        { label: "Abrir conversa", icon: MessageCircle, action: () => { onSelect(state.jid, state.name); onClose(); } },
        // minha versao: marcar como nao lida / lida (ajuda quem divide o atendimento)
        state.marcadaNova
            ? { label: "Marcar como lida", icon: MailOpen, action: () => { onAlternarLida(state.jid, false); onClose(); } }
            : { label: "Marcar como não lida", icon: Mail, action: () => { onAlternarLida(state.jid, true); onClose(); } },
        ...(state.arquivada ? [] : [state.fixada
            ? { label: "Desafixar", icon: PinOff, action: () => alterar("pin", { pin: false }, "Conversa desafixada") }
            : { label: "Fixar no topo", icon: Pin, action: () => alterar("pin", { pin: true }, "Conversa fixada") }]),
        state.silenciada
            ? { label: "Reativar som", icon: Bell, action: () => alterar("mute", { mute: false }, "Som reativado") }
            : { label: "Silenciar…", icon: BellOff, action: () => setSubmenu("silenciar") },
        state.arquivada
            ? { label: "Desarquivar", icon: ArchiveRestore, action: () => alterar("archive", { archive: false }, "Conversa desarquivada") }
            : { label: "Arquivar", icon: Archive, action: () => alterar("archive", { archive: true }, "Conversa arquivada") },
        { label: "Etiquetas", icon: Tag, action: () => { onEtiquetas(); onClose(); } },
        { label: "Copiar ID", icon: Info, action: () => { navigator.clipboard.writeText(state.jid).then(() => toast.success("ID copiado!")); onClose(); } },
    ];

    const altura = items.length * 36 + 8;
    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (state.x > window.innerWidth - 180) style.left = state.x - 180;
    if (state.y > window.innerHeight - altura) style.top = Math.max(8, state.y - altura);

    return (
        <div ref={ref} style={style} className="w-44 rounded-xl bg-popover border shadow-xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button key={i} onClick={item.action} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer text-foreground hover:bg-muted">
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// ─── Chat Row ──────────────────────
function ChatRow({
    chat, isSelected, onSelect, sessionId, labelDots, onAlternarLida
}: {
    chat: ChatContact; isSelected: boolean; onSelect: (jid: string, name?: string) => void; sessionId: string;
    labelDots: { colorHex: string }[];
    onAlternarLida: (jid: string, naoLida: boolean) => void;
}) {
    const displayName = getDisplayName(chat);
    const marcadaNaoLida = !isSelected && !!chat.naoLida && !(chat.unread || 0);
    const temNovas = !isSelected && ((chat.unread || 0) > 0 || !!chat.naoLida);
    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
    const [alvoArrasto, setAlvoArrasto] = useState(false);
    const [labelOpen, setLabelOpen] = useState(false); // minha versao: diálogo de etiquetas (abre pelo clique direito)
    // minha versao: busca a foto do contato/grupo por linha (o banco nao traz a foto)
    const [pic, setPic] = useState<string | null>(chat.profilePic || picCache.get(chat.jid) || null);
    useEffect(() => {
        if (pic) return;
        if (picCache.has(chat.jid)) { const c = picCache.get(chat.jid)!; if (c) setPic(c); return; }
        let active = true;
        fetch(`/api/chat/${sessionId}/${encodeURIComponent(chat.jid)}/profile-picture`, { method: "POST" })
            .then((r) => r.json())
            .then((d) => { picCache.set(chat.jid, d?.profilePicUrl || null); if (active && d?.profilePicUrl) setPic(d.profilePicUrl); })
            .catch(() => {});
        return () => { active = false; };
    }, [chat.jid, sessionId, pic]);

    return (
        <>
            {ctxMenu && (
                <ChatContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} sessionId={sessionId} onSelect={onSelect} onAlternarLida={onAlternarLida} onEtiquetas={() => setLabelOpen(true)} />
            )}
            <div
                className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 border-b border-border/10 group overflow-hidden cursor-pointer",
                    isSelected
                        ? "bg-primary/8 border-l-2 border-l-primary"
                        : "hover:bg-muted/40 border-l-2 border-l-transparent",
                    alvoArrasto && "bg-primary/20 ring-2 ring-inset ring-primary"
                )}
                onClick={() => onSelect(chat.jid, displayName)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, jid: chat.jid, name: displayName, marcadaNova: temNovas, fixada: !!chat.fixada, silenciada: !!chat.silenciada, arquivada: !!chat.arquivada }); }}
                // minha versao: soltar arquivos em cima do contato -> abre a conversa dele com a previa de envio
                onDragEnter={(e) => { if (temArquivos(e)) { e.preventDefault(); setAlvoArrasto(true); } }}
                onDragOver={(e) => { if (temArquivos(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvoArrasto(false); }}
                onDrop={(e) => {
                    if (!temArquivos(e)) return;
                    e.preventDefault(); setAlvoArrasto(false);
                    const lista = Array.from(e.dataTransfer.files || []);
                    if (!lista.length) return;
                    deixarArquivos(chat.jid, lista);
                    onSelect(chat.jid, displayName);
                }}
            >
                <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={pic || ""} />
                    <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-primary/20 to-primary/10 text-primary">
                        {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex justify-between items-baseline gap-2 overflow-hidden">
                        <h4 className={cn("text-sm truncate flex items-center gap-1.5", isSelected ? "font-semibold text-primary" : temNovas ? "font-bold text-foreground" : "font-medium text-foreground")}>
                            {displayName}
                            {/* Label dots — always visible */}
                            {labelDots.length > 0 && (
                                <span className="flex items-center gap-[2px] shrink-0">
                                    {labelDots.map((d, i) => (
                                        <span key={i} className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: d.colorHex }} title={d.colorHex} />
                                    ))}
                                </span>
                            )}
                        </h4>
                        {chat.lastMessage && (
                            <span className={cn("text-[10px] flex-shrink-0", temNovas ? "text-primary font-semibold" : "text-muted-foreground")}>{getTimeLabel(chat.lastMessage.timestamp)}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 min-w-0">
                        {chat.lastMessage?.fromMe && <Tiques status={chat.lastMessage.status} />}
                        <p className={cn("text-xs truncate flex-1 min-w-0", temNovas ? "text-foreground font-medium" : "text-muted-foreground")}>{getMessagePreview(chat)}</p>
                        {/* minha versao: estado da conversa (igual ao WhatsApp) */}
                        {chat.silenciada && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Silenciada" />}
                        {chat.fixada && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground rotate-45" aria-label="Fixada" />}
                        {temNovas && (marcadaNaoLida ? (
                            <span className="ml-1 shrink-0 h-3 w-3 rounded-full bg-primary" title="Marcada como não lida" />
                        ) : (
                            <span key={chat.unread} className={cn("selo-pop ml-1 shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-5 text-center", chat.silenciada ? "bg-muted-foreground/40 text-background" : "bg-primary text-primary-foreground")} title={`${chat.unread} mensage${chat.unread === 1 ? "m nova" : "ns novas"}`}>
                                {chat.unread! > 99 ? "99+" : chat.unread}
                            </span>
                        ))}
                    </div>
                </div>

            </div>

            {/* minha versao: etiquetas movidas para o clique direito (sem botao na linha) */}
            <LabelAssignDialog sessionId={sessionId} jid={chat.jid} nome={displayName} open={labelOpen} onOpenChange={setLabelOpen} />
        </>
    );
}

function SkeletonRow() {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-40" />
            </div>
        </div>
    );
}

// ─── Busca (minha versao) ──────────────────────────
type ContatoBusca = { jid: string; nome: string | null; salvo: boolean };
type MensagemBusca = { keyId: string; remoteJid: string; content: string | null; fromMe: boolean; pushName: string | null; nomeConversa: string | null; timestamp: string };

function SecaoBusca({ titulo, children, vazio, mostrarVazio }: { titulo: string; children: React.ReactNode[]; vazio?: string; mostrarVazio?: boolean }) {
    if (!children.length && !mostrarVazio) return null;
    return (
        <div className="pt-2">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">{titulo}</p>
            {children.length ? children : <p className="px-3 py-2 text-xs text-muted-foreground">{vazio}</p>}
        </div>
    );
}

/** realca o termo buscado no trecho da mensagem (sem diferenciar maiusculas) */
function Destaque({ texto, termo }: { texto: string; termo: string }) {
    const i = termo ? texto.toLowerCase().indexOf(termo.toLowerCase()) : -1;
    if (i < 0) return <>{texto}</>;
    const ini = Math.max(0, i - 40);
    return (
        <>
            {ini > 0 ? "…" : ""}{texto.slice(ini, i)}
            <mark className="bg-primary/25 text-foreground rounded-sm px-0.5">{texto.slice(i, i + termo.length)}</mark>
            {texto.slice(i + termo.length)}
        </>
    );
}

// ─── Main ──────────────────────────
export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const t = useTranslations("chat");
    const [chats, setChats] = useState<ChatContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchInput, setSearchInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [novaModo, setNovaModo] = useState<"agenda" | "numero">("agenda");
    const [novaInicial, setNovaInicial] = useState<{ numero?: string } | undefined>(undefined);
    // minha versao: resultados extras da busca (contatos sem conversa e mensagens de todas as conversas)
    const [buscaExtra, setBuscaExtra] = useState<{ contatos: ContatoBusca[]; mensagens: MensagemBusca[] }>({ contatos: [], mensagens: [] });
    const [hasMore, setHasMore] = useState(true);
    const [filter, setFilter] = useState<ChatListFilter>("all");
    const [filterReady, setFilterReady] = useState(false);

    const filterOptions: { value: ChatListFilter; label: string }[] = useMemo(() => [
        { value: "all", label: t("filterAll") },
        { value: "private", label: t("filterChats") },
        { value: "groups", label: t("filterGroups") },
        { value: "archived", label: "Arquivadas" },
    ], [t]);
    // Label dots per JID — {colorHex}[]
    const [chatLabelMap, setChatLabelMap] = useState<Map<string, {colorHex: string}[]>>(new Map());

    const { getSocket, joinSession } = useSocket();
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cursorRef = useRef<string | undefined>(undefined);
    const chatsRef = useRef<ChatContact[]>(chats);
    chatsRef.current = chats;
    const fetchingRef = useRef(false);
    // Incremented on every list reset so responses from a previous filter/search are discarded
    const requestIdRef = useRef(0);

    // Load persisted filter after mount (localStorage is unavailable during SSR)
    useEffect(() => {
        setFilter(readStoredFilter());
        setFilterReady(true);
    }, []);

    const handleFilterChange = (value: ChatListFilter) => {
        if (value === filter) return;
        setFilter(value);
        try { localStorage.setItem(FILTER_STORAGE_KEY, value); } catch { /* storage unavailable */ }
    };

    const fetchChats = useCallback(async (cursor?: string, append = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        const requestId = requestIdRef.current;
        try {
            if (!cursor) setLoading(true);
            const rawChats: any = await getChatsStatus(sessionId, PAGE_SIZE, cursor || undefined, searchQuery || undefined, filter);
            if (requestId !== requestIdRef.current) return;
            
            const processChats = (newChatsList: ChatContact[], existingChatsList: ChatContact[] = []) => {
                const merged = new Map(existingChatsList.map(c => [c.jid, c]));
                (newChatsList || []).forEach((c: any) => {
                    const existing = merged.get(c.jid);
                    if (!existing || (c.lastMessage?.timestamp && (!existing.lastMessage?.timestamp || new Date(c.lastMessage.timestamp) > new Date(existing.lastMessage.timestamp)))) {
                        merged.set(c.jid, c);
                    }
                });
                return Array.from(merged.values()).sort(ordenarConversas);
            };

            if (append) {
                setChats(prev => processChats(rawChats, prev));
            } else {
                setChats(processChats(rawChats));
            }
            setHasMore((rawChats || []).length >= PAGE_SIZE);
        } catch (error) {
            console.error("Failed to load chats", error);
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
                fetchingRef.current = false;
            }
        }
    }, [sessionId, searchQuery, filter]);

    useEffect(() => {
        if (!filterReady) return;
        requestIdRef.current++;
        fetchingRef.current = false;
        setChats([]);
        setHasMore(true);
        fetchChats();
    }, [fetchChats, filterReady]);

    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        // minha versao: o tempo real caiu e voltou (rede, servidor reiniciado, aba suspensa) -> o que chegou nesse
        // meio-tempo nao veio pelo socket. Recarrega a lista em vez de ficar com ela parada.
        let primeiraConexao = true;
        const onConnect = () => {
            joinSession(sessionId);
            if (!primeiraConexao) { fetchingRef.current = false; fetchChats(); }
            primeiraConexao = false;
        };
        if (socket.connected) { joinSession(sessionId); primeiraConexao = false; }
        socket.on("connect", onConnect);
        const handler = async (incoming: any[]) => {
            // minha versao: o socket recebe eventos de TODAS as sessoes abertas; aceita so os desta sessao
            // e respeita o arquivo: mensagem em conversa arquivada nao a tira do arquivo (como no WhatsApp)
            const newMessages = incoming.filter(msg => msg.remoteJid && msg.sessionKey === sessionId && matchesFilter(msg.remoteJid, filter)
                && (filter === "archived" ? !!msg.arquivada : !msg.arquivada));
            if (newMessages.length === 0) return;
            let needsReload = false;
            setChats(prev => {
                const updated = [...prev];
                newMessages.forEach(msg => {
                    const jid = msg.remoteJid;
                    const idx = updated.findIndex(c => c.jid === jid);
                    if (idx !== -1) {
                        const c = updated[idx];
                        // minha versao: edicao/apagada de mensagem antiga nao vira "ultima mensagem"
                        const maisNova = !c.lastMessage?.timestamp || new Date(msg.timestamp).getTime() >= new Date(c.lastMessage.timestamp).getTime();
                        if (!maisNova) return;
                        // contador: mensagem recebida ao vivo soma (se a conversa nao esta aberta); minha resposta zera
                        let unread = c.unread || 0;
                        if (msg.fromMe) unread = 0;
                        else if (msg.live && jid !== selecionadoRef.current) unread += 1;
                        updated[idx] = { ...c, unread, lastMessage: { content: msg.content, timestamp: msg.timestamp, type: msg.type, fromMe: !!msg.fromMe, status: msg.status, keyId: msg.keyId } };
                    } else { needsReload = true; }
                });
                updated.sort(ordenarConversas);
                return updated;
            });
            if (needsReload) fetchChats();
        };
        // minha versao: arquivada / silenciada / fixada mudou (no painel ou no celular)
        const onEstado = (d: any) => {
            if (d?.sessionKey !== sessionId || !d.jid) return;
            const naAba = filter === "archived" ? !!d.arquivada : !d.arquivada;
            let falta = false;
            setChats(prev => {
                const idx = prev.findIndex(c => c.jid === d.jid);
                if (idx === -1) { falta = naAba && matchesFilter(d.jid, filter); return prev; }
                if (!naAba) return prev.filter(c => c.jid !== d.jid); // saiu desta aba (arquivou/desarquivou)
                const novo = [...prev];
                novo[idx] = { ...novo[idx], arquivada: d.arquivada, silenciada: d.silenciada, silenciadaAte: d.silenciadaAte, fixada: d.fixada, fixadaEm: d.fixadaEm };
                return novo.sort(ordenarConversas);
            });
            if (falta) fetchChats(); // entrou nesta aba (ex.: desarquivou com a aba "Todas" aberta)
        };
        socket.on("chat.estado", onEstado);
        // minha versao: tiques da ultima mensagem (entregue/lida) e conversa lida no celular
        const onStatus = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setChats(prev => prev.map(c => c.jid === d.remoteJid && c.lastMessage?.keyId === d.keyId
                ? { ...c, lastMessage: { ...c.lastMessage!, status: d.status } } : c));
        };
        const onLida = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setChats(prev => prev.map(c => c.jid === d.jid && (c.unread || c.naoLida) ? { ...c, unread: 0, naoLida: false } : c));
        };
        const onNaoLida = (d: any) => {
            if (d?.sessionKey !== sessionId) return;
            setChats(prev => prev.map(c => c.jid === d.jid && !c.naoLida ? { ...c, naoLida: true } : c));
        };
        socket.on("chat.naoLida", onNaoLida);
        socket.on("message.update", handler);
        socket.on("message.status", onStatus);
        socket.on("chat.lida", onLida);
        return () => {
            socket.off("connect", onConnect); socket.off("message.update", handler);
            socket.off("message.status", onStatus); socket.off("chat.lida", onLida); socket.off("chat.naoLida", onNaoLida);
            socket.off("chat.estado", onEstado);
        };
    }, [sessionId, getSocket, joinSession, fetchChats, filter]);

    // conversa aberta: zera o contador dela na lista
    const selecionadoRef = useRef<string | undefined>(selectedJid);
    selecionadoRef.current = selectedJid;
    useEffect(() => {
        if (!selectedJid) return;
        setChats(prev => prev.map(c => c.jid === selectedJid && (c.unread || c.naoLida) ? { ...c, unread: 0, naoLida: false } : c));
    }, [selectedJid]);

    // minha versao: marcar como nao lida / lida pela lista
    const alternarLida = useCallback((jid: string, naoLida: boolean) => {
        setChats(prev => prev.map(c => c.jid === jid ? (naoLida ? { ...c, naoLida: true } : { ...c, naoLida: false, unread: 0 }) : c));
        (naoLida ? marcarConversaNaoLida(sessionId, jid) : marcarConversaLida(sessionId, jid))
            .then(() => toast.success(naoLida ? "Marcada como não lida" : "Marcada como lida"))
            .catch((e: any) => toast.error(e?.message || "Não consegui marcar"));
    }, [sessionId]);

    // Fetch label assignments for all chats
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                // Batch fetch all chat-label assignments in 1 call
                const res = await fetch(`/api/labels/${sessionId}/chats`);
                if (!res.ok) return;
                const data = await res.json();
                const map = new Map<string, { colorHex: string }[]>();
                for (const cl of (data.data || [])) {
                    const jid = cl.chatJid;
                    if (!map.has(jid)) map.set(jid, []);
                    map.get(jid)!.push({ colorHex: cl.colorHex });
                }
                setChatLabelMap(map);
            } catch (e) {
                console.error("Failed to load label assignments", e);
            }
        })();
    }, [sessionId]);

    const handleSearchChange = (val: string) => {
        setSearchInput(val);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setSearchQuery(val);
        }, 300);
    };

    // minha versao: a busca e feita no servidor (todas as conversas, por nome e por numero com qualquer formatacao);
    // filtrar de novo aqui descartava, por exemplo, quem foi achado pelo numero digitado com espacos e traco
    const filteredChats = chats;
    const buscando = searchQuery.trim().length > 0;

    useEffect(() => {
        const termo = searchQuery.trim();
        if (termo.length < 2) { setBuscaExtra({ contatos: [], mensagens: [] }); return; }
        let vivo = true;
        buscarGeralChats(sessionId, termo)
            .then((r: any) => { if (vivo) setBuscaExtra({ contatos: r?.contatos || [], mensagens: r?.mensagens || [] }); })
            .catch(() => { if (vivo) setBuscaExtra({ contatos: [], mensagens: [] }); });
        return () => { vivo = false; };
    }, [searchQuery, sessionId]);

    // numero digitado na busca -> atalho para conversar com ele (mesmo fora da agenda)
    const numeroDigitado = useMemo(() => {
        const termo = searchQuery.trim();
        if (!/^[+\d\s().-]{10,}$/.test(termo)) return null;
        return normalizarNumero(termo);
    }, [searchQuery]);
    const contatosSemConversa = useMemo(() => {
        const naLista = new Set(chats.map((c) => c.jid));
        return buscaExtra.contatos.filter((c) => !naLista.has(c.jid));
    }, [buscaExtra.contatos, chats]);

    const handleEndReached = useCallback(() => {
        if (hasMore && !loading && !searchQuery.trim()) {
            const last = chatsRef.current[chatsRef.current.length - 1];
            const c = last?.lastMessage?.timestamp;
            if (c) fetchChats(c, true);
        }
    }, [hasMore, loading, searchQuery, fetchChats]);

    const itemContent = useCallback(
        (_: number, chat: ChatContact) => <ChatRow key={chat.jid} chat={chat} isSelected={selectedJid === chat.jid} onSelect={onSelectChat} sessionId={sessionId} labelDots={chatLabelMap.get(chat.jid) || []} onAlternarLida={alternarLida} />,
        [selectedJid, onSelectChat, sessionId, chatLabelMap, alternarLida]
    );

    const emptyLabel = searchQuery
        ? t("emptySearch")
        : filter === "archived" ? "Nenhuma conversa arquivada."
        : filter === "groups" ? t("emptyGroups") : t("emptyChats");

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Header (minha versao: mais compacto, sobra espaco para os chats) */}
            <div className="shrink-0 px-2.5 pt-2 pb-1.5 space-y-1.5 border-b border-border/10">
                <div className="flex justify-between items-center gap-2">
                    {/* titulo + busca na MESMA linha para economizar altura */}
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input placeholder={t("searchPlaceholder")} value={searchInput}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="h-8 pl-8 text-sm bg-muted/50 border-0 rounded-lg focus-visible:ring-1" />
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Agenda de contatos"
                            onClick={() => { setNovaModo("agenda"); setIsNewChatOpen(true); }}>
                            <BookUser className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Nova conversa (qualquer número)"
                            onClick={() => { setNovaModo("numero"); setIsNewChatOpen(true); }}>
                            <MessageSquarePlus className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div role="tablist" aria-label="Filter chats" className="flex gap-1 p-0.5 bg-muted/50 rounded-lg">
                    {filterOptions.map(option => (
                        <button key={option.value} type="button" role="tab"
                            aria-selected={filter === option.value}
                            onClick={() => handleFilterChange(option.value)}
                            className={cn(
                                "flex-1 h-6 rounded-md text-xs font-medium transition-colors cursor-pointer",
                                filter === option.value
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}>
                            {option.label}
                        </button>
                    ))}
                </div>

                {/* minha versao: nova conversa = agenda + numero novo (componente proprio) */}
                <NovaConversaDialog sessionId={sessionId} open={isNewChatOpen} onOpenChange={(v) => { setIsNewChatOpen(v); if (!v) setNovaInicial(undefined); }}
                    modo={novaModo} inicial={novaInicial} onAbrir={(jid, n) => onSelectChat(jid, n)} />
            </div>

            {/* Chat list */}
            <div className="flex-1 min-h-0">
                {buscando ? (
                    // minha versao: resultado da busca em secoes, como no WhatsApp Web
                    <div className="h-full overflow-y-auto styled-scrollbar pb-4">
                        {numeroDigitado && (
                            <button type="button" className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 text-left cursor-pointer"
                                onClick={() => { setNovaModo("numero"); setNovaInicial({ numero: searchQuery.trim() }); setIsNewChatOpen(true); }}>
                                <span className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0"><MessageSquarePlus className="h-5 w-5" /></span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium">Conversar com {formatarTelefone(numeroDigitado) || "+" + numeroDigitado}</span>
                                    <span className="block text-[11px] text-muted-foreground">Mesmo fora da agenda. O número é conferido no WhatsApp.</span>
                                </span>
                            </button>
                        )}
                        <SecaoBusca titulo="Conversas" vazio={loading ? "Buscando…" : "Nenhuma conversa encontrada."} mostrarVazio>
                            {filteredChats.map((chat) => (
                                <ChatRow key={chat.jid} chat={chat} isSelected={selectedJid === chat.jid} onSelect={onSelectChat} sessionId={sessionId} labelDots={chatLabelMap.get(chat.jid) || []} onAlternarLida={alternarLida} />
                            ))}
                        </SecaoBusca>
                        <SecaoBusca titulo="Contatos">
                            {contatosSemConversa.map((c) => {
                                const nome = c.nome || formatarTelefone(c.jid.split("@")[0]) || c.jid.split("@")[0];
                                return (
                                    <button key={c.jid} type="button" className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/60 text-left cursor-pointer"
                                        onClick={() => onSelectChat(c.jid, nome)}>
                                        <span className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">{(nome[0] || "?").toUpperCase()}</span>
                                        <span className="min-w-0">
                                            <span className="block text-sm truncate">{nome}</span>
                                            <span className="block text-[11px] text-muted-foreground truncate">{formatarTelefone(c.jid.split("@")[0])}{c.salvo ? "" : " · não salvo"}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </SecaoBusca>
                        <SecaoBusca titulo="Mensagens">
                            {buscaExtra.mensagens.map((m) => {
                                const nome = m.nomeConversa || formatarTelefone(m.remoteJid.split("@")[0]) || m.remoteJid.split("@")[0];
                                return (
                                    <button key={m.keyId} type="button" className="w-full flex flex-col px-3 py-2 hover:bg-muted/60 text-left cursor-pointer"
                                        onClick={() => onSelectChat(m.remoteJid, nome)}>
                                        <span className="flex justify-between gap-2">
                                            <span className="text-sm font-medium truncate">{nome}</span>
                                            <span className="text-[10px] text-muted-foreground shrink-0">{getTimeLabel(m.timestamp)}</span>
                                        </span>
                                        <span className="text-xs text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]">
                                            {m.fromMe ? "Você: " : ""}<Destaque texto={m.content || ""} termo={searchQuery.trim()} />
                                        </span>
                                    </button>
                                );
                            })}
                        </SecaoBusca>
                    </div>
                ) : loading && chats.length === 0 ? (
                    <div className="py-1">
                        {[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
                    </div>
                ) : filteredChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                            <MessageCircle className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
                    </div>
                ) : (
                    <Virtuoso style={{ height: "100%" }} data={filteredChats}
                        computeItemKey={(_: number, chat: ChatContact) => chat.jid} itemContent={itemContent}
                        endReached={handleEndReached} increaseViewportBy={200}
                        components={{ Footer: () => hasMore && !loading ? (
                            <div className="py-4 text-center">
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("scrollForMore")}</span>
                            </div>
                        ) : null }} />
                )}
            </div>
        </div>
    );
}
