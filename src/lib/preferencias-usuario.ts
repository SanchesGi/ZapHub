// minha versao: preferencias pessoais guardadas na conta (valem em qualquer computador). Por enquanto: tom de pele dos emojis.
import { z } from "zod";

export const esquemaPreferencias = z
    .object({ tomDePele: z.number().int().min(0).max(5).optional() })
    .refine((v) => v.tomDePele !== undefined, { message: "Nenhuma preferência informada" });

export type PreferenciasEntrada = z.infer<typeof esquemaPreferencias>;
