// minha versao: entrada do simbolo na tela de login. O Z se desenha traco a traco e o nucleo aparece por ultimo
// com um leve "pop" (~1,6 s). Depois, o nucleo reage de leve quando um pulso chega ao hub (ciclo `hub-reage`, 12 s).
//
// Por que a troca discreta: os tracos (linha central, largura 28, pontas retas) diferem do simbolo oficial so no corte
// da diagonal (reto no lugar do arco concentrico ao nucleo). Um clipPath com o contorno oficial nao serviria, porque a
// diagonal do traco e mais curta que o arco e nao preencheria a area. Entao, ao fim dos 1,6 s, os tracos somem e entra o
// `SimboloZapHub` oficial no mesmo lugar (mesmo viewBox). O nucleo do tracado fica por cima e continua pulsando.
// Estado final = simbolo oficial, sem desvio. Tudo em CSS (globals.css: simbolo-*, hub-reage).
// Com prefers-reduced-motion aparece so o simbolo oficial, pronto.
import { SimboloZapHub } from "@/components/marca/logo-zaphub";

export function SimboloZapHubAnimado({ className = "" }: { className?: string }) {
    return (
        <span role="img" aria-label="ZapHub" className={`relative inline-block ${className}`}>
            <SimboloZapHub title="" className="simbolo-final block h-auto w-full" />
            <svg viewBox="20.2 40 215.6 176" aria-hidden focusable="false" className="simbolo-animado absolute inset-0 h-full w-full"
                fill="none" stroke="currentColor" strokeWidth={28} strokeLinejoin="miter" strokeMiterlimit={10}>
                <path d="M22 54H202L156.3 99.7" pathLength={1} className="simbolo-traco simbolo-traco-1" />
                <path d="M99.7 156.3L54 202H234" pathLength={1} className="simbolo-traco simbolo-traco-2" />
                <g className="hub-reage">
                    <circle cx="128" cy="128" r="22" fill="currentColor" stroke="none" className="simbolo-nucleo" />
                </g>
            </svg>
        </span>
    );
}
