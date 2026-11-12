// minha versao: o campo `message` das rotas de envio da API (/send e /reply).
// Aceita texto puro ("Ola") ou um objeto com campos CONHECIDOS. Qualquer outro campo e recusado: o objeto vai ao
// WhatsApp, e tipos como `ptv` ou `image: { stream }` fariam o servidor ler arquivos locais ou enderecos internos.
// Midia so por URL https; o servico baixa com o filtro seguro (lib/security: sem enderecos internos, com limite).
import { z } from "zod";

const urlHttp = z.string().max(2048).regex(/^https:\/\/[^/\s]+/i, "a URL da mídia precisa começar com https://");
const urlMidia = z.object({ url: urlHttp }).strict();

export const conteudoApiSchema = z
    .object({
        text: z.string().min(1).max(65536).optional(),
        caption: z.string().max(65536).optional(),
        image: urlMidia.optional(),
        video: urlMidia.optional(),
        audio: urlMidia.optional(),
        document: urlMidia.optional(),
        sticker: z.union([urlHttp, urlMidia.extend({ pack: z.string().max(100).optional(), author: z.string().max(100).optional() }).strict()]).optional(),
        fileName: z.string().max(255).optional(),
        mimetype: z.string().max(100).optional(),
        ptt: z.boolean().optional(),
    })
    .strict()
    .refine((c) => !!(c.text || c.image || c.video || c.audio || c.document || c.sticker), {
        message: "informe text ou uma mídia (image, video, audio, document ou sticker)",
    })
    .refine((c) => [c.image, c.video, c.audio, c.document, c.sticker].filter(Boolean).length <= 1, {
        message: "envie uma mídia por mensagem",
    })
    .refine((c) => !(c.sticker && (c.text || c.caption)), {
        message: "figurinha não leva texto nem legenda",
    });

/** `message` de /send e /reply: texto puro ou objeto { text } / mídia por URL */
export const mensagemApiSchema = z.union([z.string().min(1, "mensagem obrigatória").max(65536), conteudoApiSchema]);

export type MensagemApi = z.infer<typeof mensagemApiSchema>;

/** sempre um objeto para o servico (texto puro vira { text }) */
export function paraConteudo(m: MensagemApi): Record<string, any> {
    return typeof m === "string" ? { text: m } : { ...m };
}
