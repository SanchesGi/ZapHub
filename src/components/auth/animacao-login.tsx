// minha versao: fundo da tela de login — "mensagens chegando ao hub". Linhas finas em ambar saem das bordas
// (90 graus e 45 graus, como tracos de circuito) e convergem para o simbolo; pulsos curtos correm por elas ate o centro.
// So CSS/SVG (keyframes em globals.css: circuito-*), sem JS por quadro. Valores fixos (nada de Math.random)
// para o HTML do servidor e do navegador baterem.
//
// Este componente vai DENTRO do bloco do simbolo (pai com position: relative e do tamanho do ladrilho):
// o SVG de 2000 px fica centrado no ladrilho, entao o ponto (0,0) do desenho e o hub. O pai de tela cheia
// corta o que passar (overflow-hidden). Ciclo dos pulsos = 12 s, o mesmo de `hub-reage` (globals.css).

// Coordenadas relativas ao hub. Cada linha termina a ~46 px do centro, logo fora do ladrilho de 64 px.
// `d` = atraso do primeiro pulso (s): o pulso chega ao hub em d + 1,92 s (ver keyframes circuito-pulso).
const LINHAS: { tr: string; d: number }[] = [
    { tr: "M140 -1000V-380L0 -240V-46", d: 1.8 },
    { tr: "M-1000 -230H-700L-470 0H-46", d: 3.3 },
    { tr: "M1000 120H640L520 0H46", d: 4.2 },
    { tr: "M-593 -1000V-593L-33 -33", d: 5.9 },
    { tr: "M433 -1000V-433L33 -33", d: 6.6 },
    { tr: "M-1000 533H-533L-33 33", d: 8.4 },
    { tr: "M683 1000V683L33 33", d: 9.1 },
    { tr: "M-150 1000V400L0 250V46", d: 9.6 },
];

export function AnimacaoLogin() {
    return (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[2000px] w-[2000px] -translate-x-1/2 -translate-y-1/2">
            <svg viewBox="-1000 -1000 2000 2000" className="h-full w-full" fill="none" focusable="false">
                {LINHAS.map((l, i) => (
                    <g key={i}>
                        <path d={l.tr} className="circuito-linha" />
                        <path d={l.tr} pathLength={1} className="circuito-pulso" style={{ ["--d" as string]: `${l.d}s` }} />
                    </g>
                ))}
            </svg>
        </div>
    );
}
