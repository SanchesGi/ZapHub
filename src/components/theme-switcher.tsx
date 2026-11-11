"use client";

// minha versao: seletor de tema (Claro / Escuro), guardado no navegador. Padrao: escuro; o valor antigo "esmeralda" conta como escuro.
// O <head> do layout aplica o tema salvo antes de pintar; aqui só troca e salva.
import { useEffect, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Tema = "claro" | "escuro";

const OPCOES: { v: Tema; label: string; icon: typeof Sun }[] = [
    { v: "claro", label: "Claro", icon: Sun },
    { v: "escuro", label: "Escuro", icon: Moon },
];

export function aplicarTema(t: Tema) {
    const c = document.documentElement.classList;
    c.remove("dark");
    if (t === "escuro") c.add("dark");
    try { localStorage.setItem("wa-tema", t); } catch { /* navegador sem storage */ }
}

export function ThemeSwitcher({ className }: { className?: string }) {
    const [tema, setTema] = useState<Tema>("escuro");
    const [open, setOpen] = useState(false);

    useEffect(() => {
        try {
            // minha versao: qualquer valor que nao seja "claro" (inclusive o antigo "esmeralda") vale escuro
            const salvo = localStorage.getItem("wa-tema");
            if (salvo === "claro") setTema("claro");
            else if (salvo) localStorage.setItem("wa-tema", "escuro");
        } catch { /* sem storage: fica o padrao */ }
    }, []);

    const Atual = (OPCOES.find((o) => o.v === tema) || OPCOES[1]).icon;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className={`rounded-full h-10 w-10 hover:bg-muted/50 ${className || ""}`} title="Tema">
                    <Atual className="h-5 w-5 text-primary" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-1.5 rounded-xl" align="end">
                <p className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Tema</p>
                {OPCOES.map((o) => (
                    <button
                        key={o.v}
                        type="button"
                        onClick={() => { aplicarTema(o.v); setTema(o.v); setOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm hover:bg-muted transition-colors cursor-pointer"
                    >
                        <o.icon className="h-4 w-4 text-primary" />
                        <span className="flex-1 text-left">{o.label}</span>
                        {tema === o.v && <Check className="h-4 w-4 text-primary" />}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}
