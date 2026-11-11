"use client";

import { useState, useEffect, createContext, useContext } from "react";

interface SidebarContextType {
    isCollapsed: boolean;
    toggleCollapse: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
    isCollapsed: true,
    toggleCollapse: () => { },
});

export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
    // minha versao: começa RECOLHIDA por padrão (mais espaço pra conversa) — só fica aberta
    // se o usuário tiver expandido de propósito (fica lembrado no navegador).
    const [isCollapsed, setIsCollapsed] = useState(true);

    // Persist state in localStorage
    useEffect(() => {
        const saved = localStorage.getItem("sidebar-collapsed");
        if (saved === "false") setIsCollapsed(false);
    }, []);

    const toggleCollapse = () => {
        setIsCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem("sidebar-collapsed", String(next));
            return next;
        });
    };

    return (
        <SidebarContext.Provider value={{ isCollapsed, toggleCollapse }}>
            {children}
        </SidebarContext.Provider>
    );
}
