// minha versao: registra QUAL usuario do painel (atendente) enviou cada mensagem.
// O Baileys salva a mensagem enviada em paralelo ao sendMessage (evento messages.upsert), entao:
//  1) guardamos keyId -> nome num mapa global (o store le ao salvar, se ainda nao salvou);
//  2) e atualizamos o banco com algumas tentativas (se ja tinha salvado).
// O mapa fica em globalThis porque o servidor custom e o Next podem carregar copias diferentes do modulo.
import { prisma } from "@/lib/prisma";

const pendentes: Map<string, string> = ((globalThis as any).__waAgentesPendentes ??= new Map<string, string>());

export function nomeAgentePendente(keyId?: string | null): string | undefined {
    if (!keyId) return undefined;
    return pendentes.get(keyId);
}

// minha versao: IDs das mensagens que sairam PELA PLATAFORMA (painel, API, bot, agendador, disparo).
// O id e gerado antes do envio (instance.ts), entao o store ja sabe ao salvar. Mensagem minha que chega ao vivo
// sem estar aqui foi enviada FORA da plataforma (celular ou outro aparelho conectado).
const enviadasPlataforma: Set<string> = ((globalThis as any).__waEnviadasPlataforma ??= new Set<string>());
export function marcarEnvioPlataforma(keyId: string) {
    enviadasPlataforma.add(keyId);
    setTimeout(() => enviadasPlataforma.delete(keyId), 10 * 60_000);
    // se o store salvou antes (corrida rara), corrige
    setTimeout(() => {
        prisma.message.updateMany({ where: { keyId, origemEnvio: "FORA" }, data: { origemEnvio: "PLATAFORMA" } }).catch(() => {});
    }, 3_000);
}
export function enviadaPelaPlataforma(keyId?: string | null) {
    return !!keyId && enviadasPlataforma.has(keyId);
}

export async function marcarAgente(sendResult: any, nome?: string | null): Promise<void> {
    const keyId: string | undefined = sendResult?.key?.id;
    if (!keyId || !nome) return;
    pendentes.set(keyId, nome);
    setTimeout(() => pendentes.delete(keyId), 120_000);
    for (const espera of [0, 600, 1800, 4000]) {
        if (espera) await new Promise((r) => setTimeout(r, espera));
        try {
            const r = await prisma.message.updateMany({ where: { keyId }, data: { sentBy: nome, origemEnvio: "PLATAFORMA" } });
            if (r.count > 0) return;
        } catch { /* tenta de novo */ }
    }
}
