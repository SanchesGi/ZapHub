// minha versao: limitador de taxa simples, em memoria (por processo).
// Serve para conter abuso/forca-bruta/enumeracao nas rotas de API.
// Observacao: e por processo; se um dia rodar em varios processos/maquinas, trocar por Redis.
// Mantido em globalThis para sobreviver ao hot-reload do dev.

import { ipDoCliente } from "./ip-cliente";

type Balde = { contagem: number; reset: number };

const baldes: Map<string, Balde> =
  (globalThis as any).__waRateBaldes || ((globalThis as any).__waRateBaldes = new Map());

// limpeza preguicosa: de vez em quando varre e remove os baldes ja expirados
let ultimaLimpeza = 0;
function limparVelhos(agora: number) {
  if (agora - ultimaLimpeza < 60_000) return;
  ultimaLimpeza = agora;
  for (const [k, v] of baldes) if (agora > v.reset) baldes.delete(k);
}

export type ResultadoLimite = { ok: boolean; restante: number; emSegundos: number };

/**
 * Conta uma tentativa em `chave`. Retorna ok=false se passou de `limite` dentro de `janelaMs`.
 */
export function limitarTaxa(chave: string, limite: number, janelaMs: number): ResultadoLimite {
  const agora = Date.now();
  limparVelhos(agora);
  const atual = baldes.get(chave);
  if (!atual || agora > atual.reset) {
    baldes.set(chave, { contagem: 1, reset: agora + janelaMs });
    return { ok: true, restante: limite - 1, emSegundos: Math.ceil(janelaMs / 1000) };
  }
  atual.contagem++;
  const emSegundos = Math.ceil((atual.reset - agora) / 1000);
  if (atual.contagem > limite) return { ok: false, restante: 0, emSegundos };
  return { ok: true, restante: limite - atual.contagem, emSegundos };
}

/** Identifica o cliente pelo IP gravado pelo servidor (ver ip-cliente.ts); X-Forwarded-For do cliente nao vale. */
export function ipDoRequest(req: Request): string {
  return ipDoCliente(req.headers) || "desconhecido";
}

/** Resposta 429 padrao (Too Many Requests) com Retry-After. */
export function resposta429(emSegundos: number) {
  return new Response(
    JSON.stringify({ status: false, message: `Muitas tentativas. Tente novamente em ${emSegundos}s.`, error: "rate_limited" }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(emSegundos) } }
  );
}
