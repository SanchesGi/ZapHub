"use client";

// minha versao: tom de pele dos emojis do usuario logado (guardado na conta, via /api/me/preferencias).
// Cache em memoria + evento, para o painel de emojis e as reacoes do chat ficarem sempre iguais.
import { useCallback, useEffect, useState } from "react";
import { normalizarTom, type TomDePele } from "@/lib/emojis";

export const EVENTO_TOM_DE_PELE = "zaphub-tom-de-pele";

let cache: TomDePele | null = null;
let carregando: Promise<TomDePele> | null = null;

function avisar(tom: TomDePele) {
    try { window.dispatchEvent(new CustomEvent(EVENTO_TOM_DE_PELE, { detail: tom })); } catch { /* ignora */ }
}

export function tomDePeleAgora(): TomDePele {
    return cache ?? 0;
}

export function carregarTomDePele(): Promise<TomDePele> {
    if (cache !== null) return Promise.resolve(cache);
    carregando ??= fetch("/api/me/preferencias")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
            if (d?.data?.tomDePele === undefined) return 0 as TomDePele; // nao deu certo: usa o padrao, sem guardar
            cache = normalizarTom(d.data.tomDePele);
            avisar(cache);
            return cache;
        })
        .catch(() => 0 as TomDePele)
        .finally(() => { carregando = null; });
    return carregando;
}

/** muda na hora e grava na conta; se nao gravar, volta como estava */
export async function definirTomDePele(tom: TomDePele): Promise<boolean> {
    const anterior = tomDePeleAgora();
    cache = tom;
    avisar(tom);
    try {
        const r = await fetch("/api/me/preferencias", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tomDePele: tom }),
        });
        if (!r.ok) throw new Error(String(r.status));
        return true;
    } catch {
        cache = anterior;
        avisar(anterior);
        return false;
    }
}

export function useTomDePele(): [TomDePele, (tom: TomDePele) => Promise<boolean>] {
    const [tom, setTom] = useState<TomDePele>(tomDePeleAgora());
    useEffect(() => {
        const aoMudar = (e: Event) => setTom(normalizarTom((e as CustomEvent).detail));
        window.addEventListener(EVENTO_TOM_DE_PELE, aoMudar);
        carregarTomDePele().then(setTom).catch(() => {});
        return () => window.removeEventListener(EVENTO_TOM_DE_PELE, aoMudar);
    }, []);
    const definir = useCallback((novo: TomDePele) => definirTomDePele(novo), []);
    return [tom, definir];
}
