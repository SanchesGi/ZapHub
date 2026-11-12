// minha versao: trilha de auditoria de ACESSO/ADMIN. Registra login, 2FA, usuarios, papeis e senha.
// Nunca pode derrubar a acao principal (tudo em try/catch).
import { prisma } from "@/lib/prisma";
import { ipDoCliente } from "@/lib/ip-cliente";
import { MODO_DEMO } from "@/lib/demo";

export type TipoLogAcesso =
  | "LOGIN_OK" | "LOGIN_FALHA" | "LOGIN_2FA_FALHA" | "LOGOUT"
  | "2FA_ATIVADO" | "2FA_DESATIVADO" | "2FA_SETUP_FALHA"
  | "USUARIO_CRIADO" | "USUARIO_REMOVIDO" | "PAPEL_ALTERADO" | "SENHA_TROCADA"
  | "SESSAO_COMPARTILHADA" | "SESSAO_PRIVADA"
  | "SENHA_REDEFINIDA" | "EMAIL_ALTERADO"
  | "MANUTENCAO" // minha versao: pasta de midia, reiniciar, atualizar e limpezas feitas pelo painel
  | "TERMOS_ACEITOS" | "CONTA_EXCLUIDA" | "LGPD"; // minha versao: LGPD — aceite dos termos, conta apagada pelo proprio usuario, direitos do titular

export async function registrarAcesso(dados: {
  tipo: TipoLogAcesso;
  usuarioId?: string | null;
  usuarioEmail?: string | null;
  alvo?: string | null;
  ip?: string | null;
  detalhe?: string | null;
}) {
  if (MODO_DEMO) return; // minha versao: demonstracao publica nao guarda IP nem e-mail digitado por visitantes
  try {
    await prisma.logAcesso.create({
      data: {
        tipo: dados.tipo,
        usuarioId: dados.usuarioId ?? null,
        usuarioEmail: dados.usuarioEmail ?? null,
        alvo: dados.alvo ?? null,
        ip: dados.ip ?? null,
        detalhe: dados.detalhe ?? null,
      },
    });
  } catch {
    // auditoria nunca derruba a acao principal
  }
}

/** extrai o IP do cliente a partir dos headers (atras de proxy usa o X-Forwarded-For) */
export function ipDeHeaders(h: Headers | null | undefined): string | null {
  // minha versao: nunca confia em X-Forwarded-For enviado pelo cliente (ver ip-cliente.ts)
  return ipDoCliente(h);
}
