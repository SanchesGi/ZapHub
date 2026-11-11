// minha versao: exclusao de usuario (usada pelo DELETE /api/users/[id] e pelo DELETE /api/me/conta — LGPD).
// Desconecta e desloga as sessoes do WhatsApp dele, apaga tudo em transacao, remove os arquivos de midia das
// sessoes (<sessionId>-*) e derruba os sockets abertos.
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "./prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { desconectarUsuario } from "./revogar-socket";
import { nomeDeMidiaValido, pastasDeLeitura } from "./pasta-midia";

/** apaga os arquivos <sessionId>-* (sem tocar nos de outra sessao cujo nome comece igual, ex.: "loja" e "loja-2") */
export async function apagarMidiasDaSessao(sessionId: string): Promise<{ arquivos: number; bytes: number }> {
    const prefixo = `${sessionId}-`;
    const outras = await prisma.session.findMany({ where: { sessionId: { startsWith: prefixo } }, select: { sessionId: true } });
    const maisLongos = outras.map((o) => `${o.sessionId}-`).filter((p) => p.length > prefixo.length);
    let arquivos = 0, bytes = 0;
    for (const pasta of await pastasDeLeitura()) {
        let nomes: string[] = [];
        try { nomes = await fs.readdir(pasta); } catch { continue; }
        for (const nome of nomes) {
            if (!nome.startsWith(prefixo) || !nomeDeMidiaValido(nome)) continue;
            if (maisLongos.some((p) => nome.startsWith(p))) continue;
            const p = path.join(pasta, nome);
            try {
                const s = await fs.stat(p);
                if (!s.isFile()) continue;
                await fs.unlink(p);
                arquivos++; bytes += s.size;
            } catch { /* segue */ }
        }
    }
    return { arquivos, bytes };
}

export async function excluirUsuario(id: string): Promise<{ sessoesRemovidas: number; arquivosRemovidos: number; email: string | null; role: string | null }> {
    const alvo = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } });
    const sessoes = await prisma.session.findMany({ where: { userId: id }, select: { id: true, sessionId: true } });
    for (const s of sessoes) {
        const inst = waManager.getInstance(s.sessionId);
        if (inst) {
            try { if (inst.socket && inst.status === "CONNECTED") await inst.socket.logout(); } catch { /* segue */ }
            try { await inst.shutdown(); } catch { /* segue */ }
            waManager.removeInstance(s.sessionId);
        }
    }
    // as credenciais do WhatsApp nao tem chave estrangeira; saem junto com o usuario
    await prisma.$transaction([prisma.user.delete({ where: { id } }), ...sessoes.flatMap((s) => waManager.limparDadosDaSessao(s.sessionId, s.id))]);
    let arquivosRemovidos = 0;
    for (const s of sessoes) {
        const r = await apagarMidiasDaSessao(s.sessionId).catch(() => ({ arquivos: 0, bytes: 0 }));
        arquivosRemovidos += r.arquivos;
    }
    await desconectarUsuario(id).catch(() => {});
    return { sessoesRemovidas: sessoes.length, arquivosRemovidos, email: alvo?.email ?? null, role: alvo?.role ?? null };
}
