"use client";

import { ChatLayoutClient } from "./chat-layout-client";
import { useTranslations } from "next-intl";

interface ChatInterfaceProps {
    sessionId: string | null;
}

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
    const t = useTranslations("chat");

    if (!sessionId) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                {t("noActiveSession")}
            </div>
        );
    }

    return (
        // minha versao: ocupa a tela toda (cancela a margem do main)
        <div className="-m-3 sm:-m-4 lg:-m-6 h-[calc(100vh-4rem)]">
            <ChatLayoutClient key={sessionId} sessionId={sessionId} />
        </div>
    );
}

