"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getCookie, setCookie } from "@/lib/client-cookie";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Session {
    id: string;
    sessionId: string;
    name: string;
    status: string;
    userId?: string;
    privada?: boolean; // minha versao: sessao privada (so o dono)
    _count?: { sessionAccesses?: number }; // quantas pessoas tem acesso compartilhado
}

interface SessionContextType {
    sessions: Session[];
    sessionId: string;
    /** destino: para onde ir depois de trocar (ex.: a conversa de uma notificacao daquela sessao) */
    setSessionId: (id: string, destino?: string) => void;
    refreshSessions: () => Promise<void>;
    loading: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionId, setSessionIdState] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const responseData = await res.json();
                const data = responseData?.data || [];
                // Filter connected only? Or showing all but disabled?
                // Logic: Only show CONNECTED in selector for "Active" operations.
                // Show all sessions so users can manage disconnected ones (e.g. webhooks, settings)
                setSessions(data);

                // Sync with cookie
                const cookieId = getCookie("sessionId");
                if (cookieId && data.find((s: Session) => s.sessionId === cookieId)) {
                    setSessionIdState(cookieId);
                } else if (data.length > 0) {
                    // Default to first
                    const first = data[0].sessionId;
                    setSessionIdState(first);
                    setCookie("sessionId", first);
                } else {
                    setSessionIdState("");
                }
            }
        } catch (error) {
            console.error(error);
            toast.error("Falha ao carregar as sessões");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const setSessionId = (id: string, destino?: string) => {
        const mudou = id !== sessionId;
        setSessionIdState(id);
        setCookie("sessionId", id); // Sync Cookie
        if (destino) {
            // minha versao: quem chamou ja sabe a conversa certa DESTA sessao (ex.: clique numa notificacao)
            router.push(destino);
            return;
        }
        // minha versao: trocou de sessao com uma conversa aberta (/dashboard/chat/<numero>) -> volta para a lista.
        // Antes o refresh reabria o MESMO numero na sessao nova e a mensagem saia pelo numero errado (o cliente via
        // dois numeros no mesmo assunto).
        if (mudou && typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard/chat/")) {
            window.history.replaceState(null, "", "/dashboard/chat");
            router.replace("/dashboard/chat");
            router.refresh();
            return;
        }
        router.refresh(); // Sync Server Components
    };

    return (
        <SessionContext.Provider value={{ sessions, sessionId, setSessionId, refreshSessions: fetchSessions, loading }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
