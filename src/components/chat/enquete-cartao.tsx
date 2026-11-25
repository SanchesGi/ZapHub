"use client";

// minha versao: a ENQUETE como cartao na conversa (pergunta, opcoes, contagem de votos e quem votou).
// Identidade propria do ZapHub (ambar). So mostra o placar: votar pelo painel nao e possivel (ver relatorio).
import { useState } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { montarPlacar, type Enquete } from "@/lib/enquete";

type Props = {
    enquete: Enquete;
    /** nome (ou telefone) de quem votou, a partir do JID; sem resolver, mostra o numero */
    nomeDe: (jid: string) => string;
    fromMe: boolean;
};

export function EnqueteCartao({ enquete, nomeDe, fromMe }: Readonly<Props>) {
    const [aberta, setAberta] = useState<string | null>(null);
    const placar = montarPlacar(enquete);
    const rotulo = placar.totalVotantes === 1 ? "1 voto" : `${placar.totalVotantes} votos`;

    return (
        <div className={cn("rounded-xl border p-3 space-y-2.5 min-w-[230px] max-w-full", fromMe ? "border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/10" : "border-border bg-muted/40")}>
            <div className="flex items-start gap-2">
                <BarChart3 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0">
                    <p className="text-sm font-semibold break-words [overflow-wrap:anywhere]">{enquete.nome}</p>
                    <p className="text-[10px] text-muted-foreground">{enquete.multipla ? "Escolha uma ou mais opções" : "Escolha uma opção"}</p>
                </div>
            </div>

            <ul className="space-y-2">
                {placar.opcoes.map((o) => {
                    const expandida = aberta === o.nome;
                    return (
                        <li key={o.nome}>
                            <button type="button" disabled={!o.votos} onClick={() => setAberta(expandida ? null : o.nome)}
                                className={cn("w-full text-left", o.votos ? "cursor-pointer" : "cursor-default")}
                                aria-expanded={expandida}>
                                <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="break-words [overflow-wrap:anywhere] min-w-0">{o.nome}</span>
                                    <span className="flex items-center gap-1 shrink-0 tabular-nums font-medium">
                                        {o.votos}
                                        {o.votos > 0 && (expandida ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-border/60 overflow-hidden" role="progressbar"
                                    aria-valuenow={o.percentual} aria-valuemin={0} aria-valuemax={100} aria-label={`${o.nome}: ${o.percentual}%`}>
                                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${o.percentual}%` }} />
                                </div>
                            </button>
                            {expandida && o.jids.length > 0 && (
                                <p className="mt-1 text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere]">
                                    {o.jids.map(nomeDe).join(", ")}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>

            <p className="text-[10px] text-muted-foreground">{placar.totalVotantes ? rotulo : "Nenhum voto ainda"}</p>
        </div>
    );
}
