"use client";

// minha versao: botao "Corrigir" reutilizavel. Revisa o texto com o dicionario pt-BR OFFLINE (nspell)
// e abre um dialogo com os erros e sugestoes. Nada sai da VM.
import { useRef, useState } from "react";
import { SpellCheck, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { carregarCorretor, revisar, aplicarSugestao, ignorarPalavra, type ErroOrtografico } from "@/lib/corretor";

type Props = {
  texto: string;
  aoAplicar: (novo: string) => void;
  className?: string;
  rotulo?: boolean;            // mostrar a palavra "Corrigir" ao lado do icone
  titulo?: string;             // tooltip
  disabled?: boolean;
};

function trecho(texto: string, inicio: number, fim: number) {
  const a = Math.max(0, inicio - 18);
  const b = Math.min(texto.length, fim + 18);
  return {
    antes: (a > 0 ? "…" : "") + texto.slice(a, inicio),
    palavra: texto.slice(inicio, fim),
    depois: texto.slice(fim, b) + (b < texto.length ? "…" : ""),
  };
}

export function CorretorTexto({ texto, aoAplicar, className, rotulo, titulo = "Corrigir ortografia (pt-BR)", disabled }: Props) {
  const spellRef = useRef<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [trabalho, setTrabalho] = useState("");
  const [erros, setErros] = useState<ErroOrtografico[]>([]);

  const abrir = async () => {
    const t = texto.trim();
    if (!t) { toast.info("Escreva algo primeiro."); return; }
    setCarregando(true);
    try {
      const spell = spellRef.current || (spellRef.current = await carregarCorretor());
      const achados = revisar(spell, texto);
      if (achados.length === 0) { toast.success("Nenhum erro encontrado ✓"); return; }
      setTrabalho(texto);
      setErros(achados);
      setAberto(true);
    } catch (e: any) {
      toast.error("Não consegui carregar o dicionário. " + (e?.message || ""));
    } finally {
      setCarregando(false);
    }
  };

  const aplicar = (e: ErroOrtografico, sugestao: string) => {
    const novo = aplicarSugestao(trabalho, e.inicio, e.fim, sugestao);
    setTrabalho(novo);
    aoAplicar(novo);
    const restante = spellRef.current ? revisar(spellRef.current, novo) : [];
    setErros(restante);
    if (restante.length === 0) { setAberto(false); toast.success("Tudo corrigido ✓"); }
  };

  const ignorar = (e: ErroOrtografico) => {
    ignorarPalavra(e.palavra);
    try { spellRef.current?.add(e.palavra); } catch {}
    const restante = spellRef.current ? revisar(spellRef.current, trabalho) : [];
    setErros(restante);
    if (restante.length === 0) setAberto(false);
  };

  const aplicarTudo = () => {
    let novo = trabalho;
    // aplica do ULTIMO para o primeiro para os indices nao se deslocarem
    for (const e of [...erros].reverse()) {
      if (e.sugestoes[0]) novo = aplicarSugestao(novo, e.inicio, e.fim, e.sugestoes[0]);
    }
    setTrabalho(novo);
    aoAplicar(novo);
    const restante = spellRef.current ? revisar(spellRef.current, novo) : [];
    setErros(restante);
    setAberto(false);
    toast.success("Correções aplicadas ✓");
  };

  const temSugestao = erros.some((e) => e.sugestoes.length > 0);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={rotulo ? "sm" : "icon"}
        className={cn(!rotulo && "h-8 w-8", "text-muted-foreground hover:text-primary shrink-0", className)}
        title={titulo}
        disabled={disabled || carregando}
        onClick={abrir}
      >
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <SpellCheck className="h-4 w-4" />}
        {rotulo && <span className="ml-1.5">Corrigir</span>}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <SpellCheck className="h-5 w-5 text-primary" /> Revisão ortográfica
            </DialogTitle>
            <DialogDescription>
              {erros.length === 1 ? "1 palavra para revisar" : `${erros.length} palavras para revisar`} · clique na sugestão para trocar
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto px-5 pb-2 space-y-3 styled-scrollbar">
            {erros.map((e, i) => {
              const t = trecho(trabalho, e.inicio, e.fim);
              return (
                <div key={`${e.palavra}-${e.inicio}-${i}`} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground truncate">
                    {t.antes}<span className="font-semibold text-destructive underline decoration-wavy decoration-destructive/70">{t.palavra}</span>{t.depois}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.sugestoes.length > 0 ? (
                      e.sugestoes.map((s) => (
                        <button
                          key={s}
                          onClick={() => aplicar(e, s)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          {s}
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">sem sugestão</span>
                    )}
                    <button
                      onClick={() => ignorar(e)}
                      className="px-2 py-1 rounded-full text-xs text-muted-foreground hover:bg-muted ml-auto flex items-center gap-1"
                      title="Ignorar esta palavra (não avisar mais)"
                    >
                      <X className="h-3 w-3" /> ignorar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/40 px-5 py-3">
            <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>Fechar</Button>
            <Button size="sm" onClick={aplicarTudo} disabled={!temSugestao}>
              <Check className="h-4 w-4 mr-1.5" /> Aplicar tudo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
