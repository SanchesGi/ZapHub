"use client";

// minha versao: carrega os dados completos de emojis (emojibase-data, pt) so quando o painel abre. O import() dinamico faz o
// bundler separar os ~570 KB (cerca de 100 KB comprimidos) num pacote proprio que a pagina nao baixa ate alguem abrir o painel.
import { montarCategorias, type CategoriaEmoji, type DadoEmoji } from "@/lib/emojis";

let categorias: Promise<CategoriaEmoji[]> | null = null;

export function carregarCategoriasEmoji(): Promise<CategoriaEmoji[]> {
    categorias ??= import("emojibase-data/pt/compact.json")
        .then((m) => montarCategorias((m.default ?? m) as unknown as DadoEmoji[]))
        .catch((e) => {
            categorias = null; // falhou (rede): a proxima abertura tenta de novo
            throw e;
        });
    return categorias;
}
