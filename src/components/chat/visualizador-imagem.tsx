"use client";

// minha versao: visualizador de fotos do chat. Antes era so a imagem em tela cheia (fechar ou baixar).
//  - zoom: rodinha do mouse (no ponto do cursor), botoes + e -, duplo clique (1x <-> 2,5x), pinca no touch;
//  - arrastar para mover a foto ampliada; girar 90 graus;
//  - passar para a foto anterior/proxima da conversa (setas da tela e do teclado).
// Teclado: + e - (zoom), 0 (tamanho original), R (girar), setas (trocar). Esc fecha (tratado em quem abre).
// Zoom e posicao ficam num estado so, calculado sem efeitos colaterais (o React pode repetir o calculo).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, RotateCw, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MIN = 1;
const MAX = 8;
const PASSO = 1.25;

type Vista = { e: number; x: number; y: number };
const INICIAL: Vista = { e: 1, x: 0, y: 0 };

/** novo zoom mantendo parado o ponto (px, py), relativo ao centro da area */
function comZoom(v: Vista, nova: number, px = 0, py = 0): Vista {
    const e = Math.min(MAX, Math.max(MIN, nova));
    if (e === MIN) return INICIAL;
    return { e, x: px - (px - v.x) * (e / v.e), y: py - (py - v.y) * (e / v.e) };
}

type Props = {
    src: string;
    imagens?: string[];               // fotos da conversa, em ordem (para anterior/proxima)
    onFechar: () => void;
    onTrocar?: (src: string) => void;
    onBaixar: (src: string) => void;
};

export function VisualizadorImagem({ src, imagens = [], onFechar, onTrocar, onBaixar }: Readonly<Props>) {
    const areaRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [vista, setVista] = useState<Vista>(INICIAL);
    const [giro, setGiro] = useState(0);
    const [arrastando, setArrastando] = useState(false);
    // ponteiros ativos (mouse ou dedos) para arrastar e para a pinca
    const ponteiros = useRef(new Map<number, { x: number; y: number }>());
    const pinca = useRef<{ dist: number; escala: number } | null>(null);
    const moveu = useRef(false);

    const idx = imagens.indexOf(src);
    const anterior = idx > 0 ? imagens[idx - 1] : null;
    const proxima = idx >= 0 && idx < imagens.length - 1 ? imagens[idx + 1] : null;

    // trocou de foto: volta ao tamanho original
    useEffect(() => { setVista(INICIAL); setGiro(0); }, [src]);

    const zoomPor = useCallback((fator: number, px = 0, py = 0) => setVista((v) => comZoom(v, v.e * fator, px, py)), []);
    const original = useCallback(() => setVista(INICIAL), []);

    const pontoRelativo = (clientX: number, clientY: number) => {
        const r = areaRef.current?.getBoundingClientRect();
        if (!r) return { x: 0, y: 0 };
        return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
    };

    // rodinha: listener nao-passivo para impedir a rolagem da pagina
    useEffect(() => {
        const el = areaRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            const px = e.clientX - (r.left + r.width / 2), py = e.clientY - (r.top + r.height / 2);
            const fator = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)); // ctrl+rodinha = pinca do touchpad
            setVista((v) => comZoom(v, v.e * fator, px, py));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // teclado
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const acoes: Record<string, (() => void) | undefined> = {
                "+": () => zoomPor(PASSO), "=": () => zoomPor(PASSO), "-": () => zoomPor(1 / PASSO), "0": original,
                r: () => setGiro((g) => (g + 90) % 360), R: () => setGiro((g) => (g + 90) % 360),
                ArrowLeft: anterior ? () => onTrocar?.(anterior) : undefined,
                ArrowRight: proxima ? () => onTrocar?.(proxima) : undefined,
            };
            const acao = acoes[e.key];
            if (acao) { e.preventDefault(); acao(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [zoomPor, original, anterior, proxima, onTrocar]);

    const onPointerDown = (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moveu.current = false;
        if (ponteiros.current.size === 2) {
            const [a, b] = [...ponteiros.current.values()];
            pinca.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, escala: vista.e };
        } else {
            setArrastando(true);
        }
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const antes = ponteiros.current.get(e.pointerId);
        if (!antes) return;
        ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ponteiros.current.size === 2 && pinca.current) {
            const [a, b] = [...ponteiros.current.values()];
            const meio = pontoRelativo((a.x + b.x) / 2, (a.y + b.y) / 2);
            const alvo = pinca.current.escala * (Math.hypot(a.x - b.x, a.y - b.y) / pinca.current.dist);
            setVista((v) => comZoom(v, alvo, meio.x, meio.y));
            moveu.current = true;
            return;
        }
        const dx = e.clientX - antes.x, dy = e.clientY - antes.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moveu.current = true;
        setVista((v) => (v.e > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    };

    const onPointerUp = (e: React.PointerEvent) => {
        ponteiros.current.delete(e.pointerId);
        if (ponteiros.current.size < 2) pinca.current = null;
        if (ponteiros.current.size === 0) setArrastando(false);
    };

    // clique FORA da foto (sem ter arrastado) fecha, como antes; clique na foto nao (senao o duplo clique fecharia)
    const onClickFundo = (e: React.MouseEvent) => {
        if (moveu.current) return;
        const r = imgRef.current?.getBoundingClientRect();
        const naFoto = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!naFoto) onFechar();
    };

    const onDuploClique = (e: React.MouseEvent) => {
        e.stopPropagation();
        const p = pontoRelativo(e.clientX, e.clientY);
        setVista((v) => (v.e > 1 ? INICIAL : comZoom(v, 2.5, p.x, p.y)));
    };

    let cursor = "zoom-in";
    if (vista.e > 1) cursor = arrastando ? "grabbing" : "grab";
    const botao = "h-9 w-9 rounded-full bg-background/80 backdrop-blur-sm";
    // portal no <body>: dentro do chat, a animacao de entrada (transform) prendia o "tela cheia" na area do chat
    // e o menu lateral ficava por cima
    if (typeof document === "undefined") return null;
    return createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 select-none" role="dialog" aria-label="Visualizar imagem">
            <div ref={areaRef}
                className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none"
                style={{ cursor }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                onClick={onClickFundo} onDoubleClick={onDuploClique}>
                <img ref={imgRef} src={src} alt="Imagem" draggable={false}
                    className="max-w-[92vw] max-h-[86vh] object-contain rounded-lg pointer-events-none"
                    style={{
                        transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.e}) rotate(${giro}deg)`,
                        transition: arrastando ? "none" : "transform 120ms ease-out",
                    }} />
            </div>

            {/* barra de cima: zoom, girar, baixar, fechar */}
            <div className="absolute top-3 right-3 flex flex-wrap justify-end items-center gap-2">
                <Button size="icon" variant="secondary" className={botao} title="Diminuir (-)" disabled={vista.e <= MIN} onClick={() => zoomPor(1 / PASSO)}><ZoomOut className="h-5 w-5" /></Button>
                <button type="button" className="min-w-14 h-9 px-2 rounded-full bg-background/80 backdrop-blur-sm text-xs font-medium tabular-nums cursor-pointer" title="Tamanho original (0)" onClick={original}>
                    {Math.round(vista.e * 100)}%
                </button>
                <Button size="icon" variant="secondary" className={botao} title="Aumentar (+)" disabled={vista.e >= MAX} onClick={() => zoomPor(PASSO)}><ZoomIn className="h-5 w-5" /></Button>
                <Button size="icon" variant="secondary" className={botao} title="Ajustar à tela" onClick={() => { original(); setGiro(0); }}><Maximize2 className="h-4 w-4" /></Button>
                <Button size="icon" variant="secondary" className={botao} title="Girar (R)" onClick={() => setGiro((g) => (g + 90) % 360)}><RotateCw className="h-5 w-5" /></Button>
                <Button size="icon" variant="secondary" className={botao} title="Baixar" onClick={() => onBaixar(src)}><Download className="h-5 w-5" /></Button>
                <Button size="icon" variant="secondary" className={botao} title="Fechar (Esc)" onClick={onFechar}><X className="h-5 w-5" /></Button>
            </div>

            {/* anterior / proxima foto da conversa */}
            {anterior && (
                <Button size="icon" variant="secondary" className="absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-background/80 backdrop-blur-sm"
                    title="Foto anterior (←)" onClick={() => onTrocar?.(anterior)}>
                    <ChevronLeft className="h-6 w-6" />
                </Button>
            )}
            {proxima && (
                <Button size="icon" variant="secondary" className="absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-background/80 backdrop-blur-sm"
                    title="Próxima foto (→)" onClick={() => onTrocar?.(proxima)}>
                    <ChevronRight className="h-6 w-6" />
                </Button>
            )}
            {imagens.length > 1 && idx >= 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background/80 backdrop-blur-sm px-3 py-1 text-xs tabular-nums">
                    {idx + 1} de {imagens.length}
                </div>
            )}
        </div>,
        document.body,
    );
}
