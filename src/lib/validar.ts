// minha versao: validacao padronizada dos corpos de request com zod (defesa em profundidade).
// Uso:
//   const v = await validarCorpo(req, meuSchema);
//   if (!v.ok) return v.resposta;
//   const { campo } = v.data;
import { NextResponse } from "next/server";
import { z } from "zod";

export async function validarCorpo<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; resposta: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    const primeiro = r.error.issues[0];
    const campo = primeiro?.path?.join(".") || "corpo";
    const msg = `Dados inválidos: ${campo} — ${primeiro?.message || "verifique os campos"}`;
    return {
      ok: false,
      resposta: NextResponse.json({ status: false, message: msg, error: "validation_error" }, { status: 400 }),
    };
  }
  return { ok: true, data: r.data };
}
