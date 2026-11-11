"use client";

import { SidebarNav } from "./sidebar-nav";
import { useSidebar } from "./sidebar-context";
import { Button } from "@/components/ui/button";
import { LogOut, KeyRound, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TrocarSenhaDialog } from "./trocar-senha";
import { DoisFatores } from "./dois-fatores";
import { LogoZapHub, SimboloZapHub } from "@/components/marca/logo-zaphub";

interface SidebarShellProps {
    appName: string;
    userName?: string | null;
    userEmail?: string | null;
    version: string;
}

export function SidebarShell({ appName, userName, userEmail, version }: SidebarShellProps) {
    const { isCollapsed } = useSidebar();
    const t = useTranslations("common");
    const tn = useTranslations("nav.items"); // minha versao: Meus dados
    const tl = useTranslations("lgpd"); // minha versao: links Termos/Privacidade
    const [senhaAberta, setSenhaAberta] = useState(false); // minha versao: trocar a propria senha

    return (
        <aside
            className={`
                bg-background/80 backdrop-blur-xl border-r border-border/40
                hidden md:flex flex-col h-full sticky left-0 top-0 z-20
                shadow-[1px_0_12px_-4px_rgba(0,0,0,0.08)]
                transition-all duration-300 ease-in-out
                ${isCollapsed ? "w-[72px]" : "w-[260px]"}
            `}
        >
            {/* Logo / Brand */}
            <div className={`border-b border-border/30 transition-all duration-300 px-3 py-3`}>
                {/* minha versao: py/px menores compensam a moldura animada (.moldura-marca), que traz o proprio respiro */}
                {/* minha versao: marca propria (Z com nucleo em ambar) no lugar da letra com degrade azul */}
                {isCollapsed ? (
                    <div className="flex justify-center">
                        <div className="moldura-marca moldura-marca-compacta">
                            <div className="h-9 w-9 rounded-lg bg-[#0D0E10] flex items-center justify-center text-[#F4A935]" title={appName}>
                                <SimboloZapHub pequeno className="w-6 h-auto" title={appName} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 className="text-xl leading-none">
                            <span className="moldura-marca"><LogoZapHub title={appName} /></span>
                        </h1>
                        <p className="text-[10px] text-muted-foreground mt-1.5 font-medium pl-3">{t("tagline")}</p>
                    </>
                )}
            </div>

            {/* Navigation */}
            <SidebarNav />

            {/* User Footer */}
            <div 
                suppressHydrationWarning={true}
                className={`border-t border-border/30 bg-background/40 transition-all duration-300 ${isCollapsed ? "p-2" : "p-4"}`}
            >
                {isCollapsed ? (
                    <div suppressHydrationWarning={true} className="flex flex-col items-center gap-2">
                        <div suppressHydrationWarning={true} className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {userName?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <button
                            onClick={() => setSenhaAberta(true)}
                            aria-label="Trocar senha" title="Trocar senha"
                            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                            <KeyRound size={16} />
                        </button>
                        <DoisFatores collapsed />
                        <Link
                            href="/dashboard/meus-dados"
                            aria-label={tn("myData")} title={tn("myData")}
                            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                            <UserRoundCog size={16} />
                        </Link>
                        <button
                            onClick={() => signOut({ callbackUrl: "/auth/login" })}
                            aria-label={t("signOut")}
                            title={t("signOut")}
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                ) : (
                    <>
                        <div suppressHydrationWarning={true} className="flex items-center gap-2.5 mb-3">
                            <div 
                                suppressHydrationWarning={true}
                                className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-xs font-bold text-primary border border-primary/10"
                            >
                                {userName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div suppressHydrationWarning={true} className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{userName || t("user")}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg border-border/40 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors mb-1.5"
                            onClick={() => setSenhaAberta(true)}
                        >
                            <KeyRound size={14} /> Trocar senha
                        </Button>
                        <DoisFatores />
                        <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg border-border/40 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors mb-1.5"
                        >
                            <Link href="/dashboard/meus-dados"><UserRoundCog size={14} /> {tn("myData")}</Link>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg border-border/40 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                            onClick={() => signOut({ callbackUrl: "/auth/login" })}
                        >
                            <LogOut size={14} /> {t("signOut")}
                        </Button>
                        <p className="text-[9px] text-muted-foreground/50 text-center mt-2 font-mono">v{version}</p>
                        <nav aria-label="Documentos legais" className="mt-1.5 flex justify-center gap-3 text-[10px] text-muted-foreground">
                            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tl("termsLink")}</Link>
                            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tl("privacyLink")}</Link>
                        </nav>
                    </>
                )}
            </div>
            <TrocarSenhaDialog open={senhaAberta} onOpenChange={setSenhaAberta} />
        </aside>
    );
}
