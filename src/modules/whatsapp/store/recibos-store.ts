// minha versao: grava os recibos (entregue/lida/tocada) de cada participante em Message.extra.recibos, para o
// "Info da mensagem". Em grupo chegam muitos recibos juntos (um por membro): junta num balde por mensagem e grava
// uma vez so, em vez de ler e escrever o banco a cada recibo.
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { batchResolveToPhoneJid, normalizeJid } from "@/lib/jid-utils";
import { emSerie } from "@/lib/fila-por-chave";
import { mesclarRecibo, normalizarRecibos, type Recibo } from "@/lib/recibos";

const ESPERA_MS = 1500;
type Balde = { dbSessionId: string; keyId: string; porJid: Map<string, Recibo>; timer: ReturnType<typeof setTimeout> };
const baldes = new Map<string, Balde>();

/** anota um recibo de `jid` para a mensagem `keyId` (horarios em milissegundos); grava logo depois */
export function registrarRecibo(dbSessionId: string, keyId: string, jid: string, recibo: Recibo): void {
    const chave = `${dbSessionId}:${keyId}`;
    let balde = baldes.get(chave);
    if (!balde) {
        const novo: Balde = {
            dbSessionId, keyId, porJid: new Map(),
            timer: setTimeout(() => {
                baldes.delete(chave);
                gravar(novo).catch((e) => logger.error("Store", "Erro ao gravar recibos da mensagem", e));
            }, ESPERA_MS),
        };
        baldes.set(chave, novo);
        balde = novo;
    }
    const atual = balde.porJid.get(jid) || {};
    balde.porJid.set(jid, { ...atual, ...recibo });
}

async function gravar(b: Balde): Promise<void> {
    await emSerie(`recibos:${b.dbSessionId}:${b.keyId}`, async () => {
        const m = await prisma.message.findUnique({
            where: { sessionId_keyId: { sessionId: b.dbSessionId, keyId: b.keyId } },
            select: { id: true, fromMe: true, extra: true },
        });
        if (!m?.fromMe) return; // recibo so interessa nas mensagens que EU enviei

        // @lid -> telefone quando o banco souber (uma consulta para todos)
        const jids = [...b.porJid.keys()];
        const mapa = await batchResolveToPhoneJid(jids, b.dbSessionId);
        const extra: Record<string, unknown> = { ...((m.extra as Record<string, unknown> | null) || {}) };
        let recibos = normalizarRecibos(extra.recibos);
        let mudou = false;
        for (const [jid, r] of b.porJid) {
            const r2 = mesclarRecibo(recibos, normalizeJid(mapa.get(jid) || jid), r);
            recibos = r2.recibos;
            mudou = mudou || r2.mudou;
        }
        if (!mudou) return;
        await prisma.message.update({ where: { id: m.id }, data: { extra: { ...extra, recibos } as any } });
    });
}
