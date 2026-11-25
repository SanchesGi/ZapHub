"use client";

// minha versao: sessoes silenciadas pelo usuario logado (guardadas na conta, via /api/me/sessoes-silenciadas).
// Um cache em memoria + evento para o menu de alertas, o notificador e o seletor de sessoes ficarem iguais.
export const EVENTO_SESSOES_SILENCIADAS = "zaphub-sessoes-silenciadas";

let cache: string[] | null = null;
let carregando: Promise<string[]> | null = null;

function avisar(ids: string[]) {
    try { window.dispatchEvent(new CustomEvent(EVENTO_SESSOES_SILENCIADAS, { detail: ids })); } catch { /* ignora */ }
}

export function sessoesSilenciadasAgora(): string[] {
    return cache ?? [];
}

export function carregarSessoesSilenciadas(): Promise<string[]> {
    if (cache) return Promise.resolve(cache);
    carregando ??= fetch("/api/me/sessoes-silenciadas")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
            cache = Array.isArray(d?.data?.ids) ? d.data.ids : [];
            avisar(cache!);
            return cache!;
        })
        .catch(() => [])
        .finally(() => { carregando = null; });
    return carregando;
}

export async function silenciarSessao(sessionId: string, silenciar: boolean): Promise<boolean> {
    const atual = sessoesSilenciadasAgora();
    const ids = silenciar ? [...new Set([...atual, sessionId])] : atual.filter((s) => s !== sessionId);
    const anterior = atual;
    cache = ids;
    avisar(ids);
    try {
        const r = await fetch("/api/me/sessoes-silenciadas", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
        });
        if (!r.ok) throw new Error(String(r.status));
        return true;
    } catch {
        cache = anterior; // nao salvou: volta como estava
        avisar(anterior);
        return false;
    }
}
