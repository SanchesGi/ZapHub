// minha versao: ilustracao do hero. Tudo passa pelo centro (o Hub): conversas, equipe e sessoes entram pela
// esquerda; API, webhooks e disparos saem pela direita. Reusa as linhas/pulsos de circuito do login (globals.css).
// So SVG/CSS, sem imagens externas. Decorativa: o texto da pagina descreve o mesmo.
import { SimboloZapHubGrupo } from "@/components/marca/logo-zaphub";

type No = { rotulo: string; x: number; y: number; lado: "e" | "d"; d: number };

const NOS: No[] = [
    { rotulo: "Conversas", x: 8, y: 62, lado: "e", d: 1.2 },
    { rotulo: "Equipe", x: 8, y: 182, lado: "e", d: 3.4 },
    { rotulo: "Sessões", x: 8, y: 302, lado: "e", d: 5.6 },
    { rotulo: "API", x: 292, y: 62, lado: "d", d: 2.3 },
    { rotulo: "Webhooks", x: 292, y: 182, lado: "d", d: 4.5 },
    { rotulo: "Disparos", x: 292, y: 302, lado: "d", d: 6.7 },
];

const LARG = 100;
const ALT = 36;

function trilho(n: No): string {
    const yn = n.y + ALT / 2;
    const xn = n.lado === "e" ? n.x + LARG : n.x;
    const xh = n.lado === "e" ? 168 : 232; // borda do ladrilho central
    const meio = n.lado === "e" ? xn + 18 : xn - 18;
    // 90 graus ate perto do centro e um trecho a 45 graus, como trilha de circuito
    const dy = 200 - yn;
    const x45 = n.lado === "e" ? meio + Math.abs(dy) : meio - Math.abs(dy);
    return dy === 0 ? `M${xn} ${yn}H${xh}` : `M${xn} ${yn}H${meio}L${x45} 200H${xh}`;
}

export function DiagramaHub({ className = "" }: { className?: string }) {
    return (
        <svg viewBox="0 0 400 400" className={className} fill="none" aria-hidden focusable="false">
            {NOS.map((n) => (
                <g key={n.rotulo}>
                    <path d={trilho(n)} className="circuito-linha" style={{ strokeOpacity: 0.35 }} />
                    <path d={trilho(n)} pathLength={1} className="circuito-pulso" style={{ ["--d" as string]: `${n.d}s` }} />
                    <rect x={n.x} y={n.y} width={LARG} height={ALT} rx={10} className="fill-card stroke-border" strokeWidth={1.25} />
                    <circle cx={n.lado === "e" ? n.x + 16 : n.x + LARG - 16} cy={n.y + ALT / 2} r={3.5} className="fill-primary" />
                    <text x={n.x + (n.lado === "e" ? 28 : 12)} y={n.y + ALT / 2 + 4.5} fontSize={12.5} fontWeight={600} className="fill-foreground" fontFamily="var(--font-geist-mono), monospace">
                        {n.rotulo}
                    </text>
                </g>
            ))}
            <rect x={168} y={168} width={64} height={64} rx={16} fill="#0D0E10" stroke="rgba(255,255,255,.1)" />
            <SimboloZapHubGrupo x={178} y={178} tamanho={44} cor="#F4A935" />
        </svg>
    );
}
