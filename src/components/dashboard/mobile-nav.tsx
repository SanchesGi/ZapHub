"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, LogOut, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { navGroups } from "./sidebar-nav";
import pkg from "../../../package.json";
import { LogoZapHub } from "@/components/marca/logo-zaphub";

export function MobileNav({ appName = "ZapHub" }: { appName?: string }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const { data: session } = useSession();
    const t = useTranslations();
    // @ts-ignore
    const userRole = session?.user?.role;

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0 flex flex-col">
                <SheetHeader className="px-4 py-3 text-left border-b border-border">
                    {/* minha versao: moldura animada em volta da marca (globals.css) */}
                    <SheetTitle className="text-xl leading-none"><span className="moldura-marca"><LogoZapHub title={appName} /></span></SheetTitle>
                    <SheetDescription className="text-[11px] text-muted-foreground -mt-1 pl-3">{t("common.tagline")}</SheetDescription>
                </SheetHeader>

                <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-1">
                    {navGroups.map((group) => {
                        const visibleItems = group.items.filter((item) => {
                            if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
                            if (item.allowedRoles && (!userRole || !item.allowedRoles.includes(userRole))) return false;
                            return true;
                        });
                        if (visibleItems.length === 0) return null;

                        return (
                            <div key={group.key} className="mb-1">
                                {group.key !== "main" && (
                                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t(`nav.groups.${group.key}`)}
                                    </p>
                                )}
                                <div className="space-y-0.5">
                                    {visibleItems.map(({ href, key, icon: Icon, external }) => (
                                        <Link
                                            key={href}
                                            href={href}
                                            target={external ? "_blank" : undefined}
                                            onClick={() => setOpen(false)}
                                            className={`
                                                flex items-center rounded-lg text-sm font-medium
                                                transition-all duration-200 group relative
                                                gap-3 px-3 py-2
                                                ${isActive(href)
                                                    ? "text-primary bg-primary/10 shadow-sm"
                                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                }
                                            `}
                                        >
                                            {isActive(href) && (
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-full" />
                                            )}
                                            <Icon
                                                size={17}
                                                className={`flex-shrink-0 transition-colors duration-200 ${isActive(href) ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`}
                                            />
                                            <span className="truncate">{t(`nav.items.${key}`)}</span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-border bg-muted/50">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                            {session?.user?.name?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{session?.user?.name || t("common.user")}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{session?.user?.email}</p>
                        </div>
                    </div>
                    <LanguageSwitcher className="w-full mb-2" />
                    {/* minha versao: Meus dados (LGPD) */}
                    <Button asChild variant="outline" size="sm" className="w-full flex items-center justify-center gap-2 text-xs h-8 mb-2">
                        <Link href="/dashboard/meus-dados" onClick={() => setOpen(false)}><UserRoundCog size={14} /> {t("nav.items.myData")}</Link>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full flex items-center justify-center gap-2 text-xs h-8"
                        onClick={async () => {
                            setOpen(false);
                            await signOut({ callbackUrl: "/auth/login" });
                        }}
                    >
                        <LogOut size={14} /> {t("common.signOut")}
                    </Button>
                    <p className="text-[10px] text-muted-foreground/70 text-center mt-2 font-mono">v{pkg.version}</p>
                    <nav aria-label="Documentos legais" className="mt-1.5 flex justify-center gap-4 text-[11px] text-muted-foreground">
                        <Link href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">{t("lgpd.termsLink")}</Link>
                        <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">{t("lgpd.privacyLink")}</Link>
                    </nav>
                </div>
            </SheetContent>
        </Sheet>
    );
}
