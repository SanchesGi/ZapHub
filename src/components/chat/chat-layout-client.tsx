"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChatList } from "./chat-list";
import { ChatWindow } from "./chat-window";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { EVENTO_ABRIR_CHAT, jidDaUrl, urlDoJid, type AbrirChatDetalhe } from "@/lib/jid-url";

interface ChatLayoutClientProps {
    sessionId: string;
    initialJid?: string;
}

interface SelectedChat {
    jid: string;
    name?: string;
}

// minha versao: limites da largura da lista de conversas (arrastar o divisor, igual WhatsApp Web)
// (o zoom da conversa fica no proprio ChatWindow — A-/A+ no cabecalho e Ctrl+scroll — para nao empilhar dois zooms)
const LARGURA_PADRAO = 340;
const LARGURA_MIN = 260;
const LARGURA_MAX = 560;

export function ChatLayoutClient({ sessionId, initialJid }: ChatLayoutClientProps) {
    const t = useTranslations("chat");
    const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(
        initialJid ? { jid: initialJid } : null
    );
    // minha versao: segunda camada contra "conversa de uma sessao aberta na outra": se a sessao mudar com este
    // componente vivo, fecha a conversa (ajuste durante a renderizacao, padrao do React para estado que depende
    // de prop). A troca pelo seletor ja volta para a lista (session-provider).
    const [sessaoDaConversa, setSessaoDaConversa] = useState(sessionId);
    if (sessaoDaConversa !== sessionId) {
        setSessaoDaConversa(sessionId);
        setSelectedChat(null);
    }

    // --- lista redimensionavel (largura persistida no navegador) ---
    const [larguraLista, setLarguraLista] = useState(LARGURA_PADRAO);
    const [isDesktop, setIsDesktop] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const larguraRef = useRef(LARGURA_PADRAO);

    // carrega a largura salva
    useEffect(() => {
        try {
            const w = Number(localStorage.getItem("wa-largura-lista"));
            if (w >= LARGURA_MIN && w <= LARGURA_MAX) { setLarguraLista(w); larguraRef.current = w; }
        } catch { /* navegador sem storage: usa o padrao */ }
    }, []);

    // so redimensiona no desktop (no celular a lista ocupa a tela toda)
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(min-width: 768px)");
        const upd = () => setIsDesktop(mq.matches);
        upd();
        mq.addEventListener("change", upd);
        return () => mq.removeEventListener("change", upd);
    }, []);

    // arrastar o divisor para mudar a largura da lista (como no WhatsApp Web)
    const iniciarArraste = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        const mover = (ev: MouseEvent) => {
            const cont = containerRef.current;
            if (!cont) return;
            let nova = ev.clientX - cont.getBoundingClientRect().left;
            nova = Math.max(LARGURA_MIN, Math.min(LARGURA_MAX, nova));
            larguraRef.current = nova;
            setLarguraLista(nova);
        };
        const soltar = () => {
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            try { localStorage.setItem("wa-largura-lista", String(Math.round(larguraRef.current))); } catch {}
            window.removeEventListener("mousemove", mover);
            window.removeEventListener("mouseup", soltar);
        };
        window.addEventListener("mousemove", mover);
        window.addEventListener("mouseup", soltar);
    }, []);

    // duplo clique no divisor: volta a largura padrao
    const resetarLargura = useCallback(() => {
        larguraRef.current = LARGURA_PADRAO;
        setLarguraLista(LARGURA_PADRAO);
        try { localStorage.setItem("wa-largura-lista", String(LARGURA_PADRAO)); } catch {}
    }, []);

    // Sync selected chat to URL pathname
    useEffect(() => {
        if (typeof window === "undefined") return;
        const base = "/dashboard/chat";
        if (selectedChat) {
            const newPath = `${base}/${urlDoJid(selectedChat.jid)}`;
            if (window.location.pathname !== newPath) {
                window.history.replaceState(null, "", newPath);
            }
        } else {
            if (window.location.pathname !== base) {
                window.history.replaceState(null, "", base);
            }
        }
    }, [selectedChat]);

    // Handle browser back/forward
    useEffect(() => {
        const handlePopState = () => {
            const path = window.location.pathname;
            if (path.startsWith("/dashboard/chat/")) {
                setSelectedChat({ jid: jidDaUrl(path.replace("/dashboard/chat/", "")) });
            } else {
                setSelectedChat(null);
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const handleSelectChat = (jid: string, name?: string) => {
        setSelectedChat({ jid, name });
    };

    // minha versao: clique na notificacao (ilha) abre a conversa aqui mesmo, sem recarregar
    useEffect(() => {
        const h = (e: Event) => {
            const d = (e as CustomEvent<AbrirChatDetalhe>).detail;
            if (d?.jid && d.sessionId === sessionId) { setSelectedChat({ jid: d.jid, name: d.name }); d.handled = true; }
        };
        window.addEventListener(EVENTO_ABRIR_CHAT, h);
        return () => window.removeEventListener(EVENTO_ABRIR_CHAT, h);
    }, [sessionId]);

    const handleBack = () => {
        setSelectedChat(null);
        if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/dashboard/chat");
        }
    };

    return (
        // Outer: flex row, full height, overflow hidden — containment chain root
        <div ref={containerRef} className="flex h-full bg-background overflow-hidden min-h-0">
            {/* Chat List Panel (largura ajustavel no desktop) */}
            <div className={`border-r border-border/30 overflow-hidden shrink-0 flex-col w-full
                ${selectedChat ? "hidden md:flex" : "flex"}`}
                style={isDesktop ? { width: larguraLista } : undefined}
            >
                {/* Inner flex-col: header fixed + virtuoso fills rest */}
                <ChatList
                    sessionId={sessionId}
                    onSelectChat={handleSelectChat}
                    selectedJid={selectedChat?.jid}
                />
            </div>

            {/* Divisor arrastavel (so no desktop) */}
            <div
                onMouseDown={iniciarArraste}
                onDoubleClick={resetarLargura}
                title="Arraste para mudar a largura · duplo clique para o padrão"
                className="hidden md:flex items-center justify-center w-1.5 shrink-0 cursor-col-resize group"
            >
                <div className="h-full w-px bg-border/40 group-hover:bg-primary/60 group-active:bg-primary transition-colors" />
            </div>

            {/* Chat Window Panel (o zoom da conversa fica dentro do proprio ChatWindow) */}
            <div className={`flex-1 overflow-hidden flex flex-col min-w-0
                ${!selectedChat ? "hidden md:flex" : "flex"}`}
            >
                {selectedChat && sessaoDaConversa === sessionId ? (
                    <ChatWindow
                        // sessao + conversa: rascunho, resposta e anexos nunca passam de uma sessao para outra
                        key={`${sessionId}|${selectedChat.jid}`}
                        sessionId={sessionId}
                        jid={selectedChat.jid}
                        name={selectedChat.name}
                        onBack={handleBack}
                        onOpenChat={handleSelectChat}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center min-w-0 min-h-0">
                        <div className="text-center p-6">
                            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                                <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {t("selectChat")}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
