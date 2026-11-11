import { prisma } from "@/lib/prisma";
import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";
import { encryptData, decryptData } from "@/lib/crypto";

// minha versao: as chaves de criptografia da sessao NAO podem se perder.
// Antes: centenas de gravacoes em paralelo esgotavam o pool do Prisma (9 conexoes, 10 s de espera) e o
// MariaDB devolvia 1020 ("Record has changed since last read"); o erro era so logado e a chave sumia.
// Pior: leitura com erro devolvia "nao existe" -> o Baileys refazia a sessao de criptografia -> "Bad MAC"
// e a sessao perdia a sincronia. Agora: novas tentativas nesses erros, no maximo 4 operacoes por vez,
// e leitura que falha de verdade lanca erro (a mensagem e reprocessada) em vez de fingir que nao ha chave.

const transitorio = (e: any) => {
    const m = String(e?.message || "");
    return e?.code === "P2024" || e?.code === "P2034" || m.includes("1020") || m.includes("Record has changed")
        || m.includes("connection pool") || m.includes("Timed out fetching") || m.includes("Deadlock");
};

async function comRetry<T>(fn: () => Promise<T>, tentativas = 6): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i >= tentativas || !transitorio(e)) throw e;
            await new Promise((r) => setTimeout(r, 150 * i + Math.random() * 250));
        }
    }
}

// executa as tarefas com no maximo `n` ao mesmo tempo
async function emLotes(tarefas: (() => Promise<void>)[], n = 4) {
    let i = 0;
    const erros: any[] = [];
    const trabalhador = async () => {
        while (i < tarefas.length) {
            const t = tarefas[i++];
            try { await t(); } catch (e) { erros.push(e); }
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, trabalhador));
    if (erros.length) throw erros[0];
}

export const usePrismaAuthState = async (sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {

    // Le com descriptografia transparente. Banco fora do ar = LANCA (nao devolve null, que corromperia a sessao).
    const readData = async (type: string, id: string) => {
        const key = `${type}-${id}`;
        const data = await comRetry(() => prisma.authState.findUnique({
            where: { sessionId_key: { sessionId, key } }
        }));
        if (!data || !data.value) return null;
        try {
            const rawStr = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
            const decryptedStr = decryptData(rawStr);
            return JSON.parse(decryptedStr, BufferJSON.reviver);
        } catch (error) {
            // conteudo ilegivel (corrompido/chave de criptografia trocada): trata como ausente, como antes
            logger.error("Auth", `Chave ${key} ilegivel (sessao ${sessionId})`, error);
            return null;
        }
    };

    // Grava com criptografia; tenta de novo em erro passageiro e avisa alto se perder mesmo assim
    const writeData = async (type: string, id: string, data: any) => {
        const key = `${type}-${id}`;
        const jsonStr = JSON.stringify(data, BufferJSON.replacer);
        const value = encryptData(jsonStr);
        try {
            await comRetry(() => prisma.authState.upsert({
                where: { sessionId_key: { sessionId, key } },
                create: { sessionId, key, value },
                update: { value }
            }));
        } catch (error) {
            logger.error("Auth", `FALHA ao gravar a chave ${key} da sessao ${sessionId} (depois de varias tentativas)`, error);
            throw error;
        }
    };

    const removeData = async (type: string, id: string) => {
        const key = `${type}-${id}`;
        try {
            await comRetry(() => prisma.authState.deleteMany({ where: { sessionId, key } }));
        } catch (error) {
            logger.error("Auth", `Falha ao remover a chave ${key} da sessao ${sessionId}`, error);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds', 'me')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    await emLotes(ids.map((id) => async () => {
                        let value = await readData(type, id);
                        if (type === 'app-state-sync-key' && value) {
                            value = BufferJSON.reviver(null, value);
                        }
                        if (value) {
                            data[id] = value;
                        }
                    }), 6);
                    return data;
                },
                set: async (data) => {
                    const tarefas: (() => Promise<void>)[] = [];
                    for (const category in data) {
                        const categoryData = data[category as keyof typeof data];
                        if (!categoryData) continue;
                        for (const id in categoryData) {
                            const value = categoryData[id];
                            tarefas.push(value ? () => writeData(category, id, value) : () => removeData(category, id));
                        }
                    }
                    await emLotes(tarefas, 4);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', 'me', creds);
        }
    }
}
