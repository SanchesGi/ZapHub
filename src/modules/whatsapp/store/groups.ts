import { prisma } from "@/lib/prisma";
import type { WASocket, GroupMetadata } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

// minha versao: repete a operacao quando o MariaDB responde 1020 ("Record has changed since last read")
export async function comRetry1020<T>(fn: () => Promise<T>, tentativas = 4): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (e: any) {
            const msg = String(e?.message || "");
            if (i >= tentativas || !(msg.includes("1020") || msg.includes("Record has changed since last read"))) throw e;
            await new Promise((r) => setTimeout(r, 80 * i + Math.random() * 120));
        }
    }
}

export async function syncGroups(sock: WASocket, sessionId: string) {
    try {
        // Verify session exists and get the actual database ID
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        
        if (!session) {
            logger.error("Store", `Session ${sessionId} does not exist, cannot sync groups`);
            return;
        }

        // Use session.id (cuid) for foreign key, not sessionId string
        const dbSessionId = session.id;

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups);

        logger.info("Store", `Found ${groupList.length} groups for session ${sessionId}`);

        let falhas = 0;
        for (const g of groupList) {
             try {
                 // minha versao: MariaDB 11.8+ (innodb_snapshot_isolation) devolve erro 1020 quando outra
                 // atualizacao mexeu no mesmo grupo ao mesmo tempo -> tenta de novo em vez de desistir
                 await comRetry1020(() => prisma.group.upsert({
                     where: { sessionId_jid: { sessionId: dbSessionId, jid: g.id } },
                     create: {
                         sessionId: dbSessionId,
                         jid: g.id,
                         subject: g.subject,
                         description: g.desc,
                         ownerJid: g.owner,
                         creation: g.creation ? new Date(g.creation * 1000) : undefined,
                         restrict: g.restrict,
                         announce: g.announce,
                         participants: g.participants as any,
                         metadata: g as any,
                         isCommunity: g.isCommunity || false,
                         linkedParentJid: g.linkedParent || null
                     },
                     update: {
                         subject: g.subject,
                         description: g.desc,
                         ownerJid: g.owner,
                         restrict: g.restrict,
                         announce: g.announce,
                         participants: g.participants as any,
                         metadata: g as any,
                         isCommunity: g.isCommunity || false,
                         linkedParentJid: g.linkedParent || null
                     }
                 }));
             } catch (e: any) {
                 falhas++;
                 logger.error("Store", `Falha ao sincronizar o grupo ${g.id}: ${String(e?.message || e).split("\n").pop()}`);
             }
        }
        logger.success("Store", `Synced ${groupList.length - falhas}/${groupList.length} groups for session ${sessionId}`);
    } catch (e) {
        logger.error("Store", "Failed to sync groups", e);
    }
}
