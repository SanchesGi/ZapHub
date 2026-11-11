// minha versao: 2FA (TOTP, tipo Google Authenticator/Authy) — SO no servidor.
// Usado apenas para SUPERADMIN. O segredo so vira "ativo" depois que o admin prova um codigo valido.
// otplib v13 (API funcional, crypto noble — multi-runtime).
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

const SERVICO = "ZapHub";

export function gerarSegredo(): string {
  return generateSecret(); // base32, 20 bytes
}

/** monta a URL otpauth:// que o app autenticador le pelo QR */
export function urlOtpauth(conta: string, segredo: string): string {
  return generateURI({ issuer: SERVICO, label: conta, secret: segredo });
}

/** gera a imagem do QR (data URL) para mostrar na tela */
export async function qrDataUrl(otpauth: string): Promise<string> {
  return QRCode.toDataURL(otpauth, { margin: 1, width: 224, errorCorrectionLevel: "M" });
}

/** confere um codigo de 6 digitos contra o segredo (±30s de tolerancia de relogio) */
export function verificarCodigo(codigo: string, segredo: string): boolean {
  try {
    const limpo = String(codigo || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(limpo)) return false;
    const r = verifySync({ secret: segredo, token: limpo, epochTolerance: 30 });
    return !!r?.valid;
  } catch {
    return false;
  }
}

// ---- minha versao: troca de fator so depois de provar o codigo novo ----
// O segredo novo NAO e gravado no usuario no /setup: vai ao cliente junto com uma "prova" assinada
// (usuario + segredo + validade). So o /enable, com a prova e o codigo certo do segredo novo, grava e ativa.
// Assim o fator ativo continua valendo ate o novo ser confirmado.
import crypto from "node:crypto";

const VALIDADE_PROVA_MS = 10 * 60_000;

function assinar(corpo: string, chave: string): string {
  return crypto.createHmac("sha256", chave).update(corpo).digest("base64url");
}

function chaveDaProva(): string {
  const k = process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("AUTH_SECRET nao definido");
  return `2fa-prova:${k}`;
}

export function criarProva(usuarioId: string, segredo: string, agora = Date.now(), chave = chaveDaProva()): string {
  const corpo = Buffer.from(JSON.stringify({ u: usuarioId, s: segredo, e: agora + VALIDADE_PROVA_MS })).toString("base64url");
  return `${corpo}.${assinar(corpo, chave)}`;
}

/** devolve o segredo da prova, ou null se for de outro usuario, estiver vencida ou adulterada */
export function lerProva(prova: unknown, usuarioId: string, agora = Date.now(), chave = chaveDaProva()): string | null {
  if (typeof prova !== "string" || prova.length > 500) return null;
  const [corpo, assinatura] = prova.split(".");
  if (!corpo || !assinatura) return null;
  const esperada = assinar(corpo, chave);
  const a = Buffer.from(assinatura), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (d?.u !== usuarioId || typeof d?.s !== "string" || typeof d?.e !== "number" || d.e < agora) return null;
    return d.s;
  } catch {
    return null;
  }
}

// ---- minha versao: um codigo TOTP vale uma vez so (impede reuso dentro da janela de aceite) ----
const usados: Map<string, number> = ((globalThis as any).__waTotpUsados ??= new Map<string, number>());
const JANELA_REUSO_MS = 90_000;

/** como verificarCodigo, mas recusa o mesmo codigo do mesmo usuario uma segunda vez */
export function verificarCodigoUnico(usuarioId: string, codigo: string, segredo: string, agora = Date.now()): boolean {
  for (const [k, ate] of usados) if (ate < agora) usados.delete(k);
  if (!verificarCodigo(codigo, segredo)) return false;
  const chave = `${usuarioId}:${String(codigo).replace(/\s/g, "")}`;
  if (usados.has(chave)) return false;
  usados.set(chave, agora + JANELA_REUSO_MS);
  return true;
}
