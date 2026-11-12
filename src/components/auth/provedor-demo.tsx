"use client";
// minha versao: diz as telas de entrada se o SERVIDOR esta em modo demonstracao (ZAPHUB_DEMO=true).
// Antes vinha de NEXT_PUBLIC_*, do build: um build com a variavel e um servidor sem o modo demo anunciariam a senha
// de um Super Administrador sem nenhum bloqueio.
import { createContext, useContext } from "react";

const ContextoDemo = createContext(false);

export function ProvedorDemo({ demo, children }: { demo: boolean; children: React.ReactNode }) {
    return <ContextoDemo.Provider value={demo}>{children}</ContextoDemo.Provider>;
}

export function useModoDemo(): boolean {
    return useContext(ContextoDemo);
}
