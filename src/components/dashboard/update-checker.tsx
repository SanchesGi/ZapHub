"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

// minha versao: so o Super Administrador checa, e no maximo 1x por hora (evita rodar git fetch a cada tela).
// A checagem compara o git local com o SEU GitHub (origin). Veja /api/system/check-updates.
export function UpdateChecker() {
    const { data } = useSession();
    useEffect(() => {
        if ((data?.user as any)?.role !== "SUPERADMIN") return;
        try {
            const k = "wa-ultimo-check-update";
            const ultimo = Number(localStorage.getItem(k) || 0);
            if (Date.now() - ultimo < 3600_000) return; // 1x por hora
            localStorage.setItem(k, String(Date.now()));
        } catch { /* sem storage: checa mesmo assim */ }
        fetch("/api/system/check-updates", { method: "POST" }).catch(() => {});
    }, [data]);

    return null;
}
