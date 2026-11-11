"use client";

// minha versao: configuracao dos alertas de mensagem (sons, ilha, notificacao do sistema, ilha flutuante)
import { useEffect, useState } from "react";
import { Bell, BellOff, PictureInPicture2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { EVENTO_ALERTAS, lerAlertas, salvarAlertas, tocarEnviada, tocarRecebida, type Alertas } from "@/lib/sons";
import { EVENTO_ILHA_FLUTUANTE, EVENTO_TESTAR_ALERTA } from "./notificador";

type Permissao = NotificationPermission | "indisponivel" | "inseguro";

function lerPermissao(): Permissao {
    if (typeof window === "undefined") return "indisponivel";
    // minha versao: pagina em http pela rede -> o navegador nao libera notificacao (precisa do HTTPS)
    if (window.isSecureContext === false) return "inseguro";
    if (!("Notification" in window)) return "indisponivel";
    return Notification.permission;
}

// mesmo caminho, no HTTPS (porta do HTTPS_PORT; padrao 3443)
const PORTA_HTTPS = process.env.NEXT_PUBLIC_HTTPS_PORT || "3443";
function enderecoHttps() {
    if (typeof window === "undefined") return "#";
    return `https://${window.location.hostname}:${PORTA_HTTPS}${window.location.pathname}${window.location.search}`;
}

export function AlertasMenu() {
    const [a, setA] = useState<Alertas | null>(null);
    const [perm, setPerm] = useState<Permissao>("default");
    const [temPip, setTemPip] = useState(false);

    useEffect(() => {
        setA(lerAlertas());
        setPerm(lerPermissao());
        setTemPip(!!(window as any).documentPictureInPicture);
        const h = (e: Event) => setA((e as CustomEvent).detail || lerAlertas());
        window.addEventListener(EVENTO_ALERTAS, h);
        return () => window.removeEventListener(EVENTO_ALERTAS, h);
    }, []);

    const muda = (p: Partial<Alertas>) => setA(salvarAlertas(p));
    const tudoMudo = a ? !a.somRecebida && !a.popup && !a.notifSistema : false;

    const pedirPermissao = async () => {
        try { setPerm(await Notification.requestPermission()); } catch { setPerm(lerPermissao()); }
    };

    const Linha = ({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) => (
        <label className="flex items-start gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer">
            <span className="flex-1 min-w-0">
                <span className="block text-sm">{label}</span>
                {desc && <span className="block text-[11px] text-muted-foreground leading-snug">{desc}</span>}
            </span>
            <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
        </label>
    );

    return (
        <Popover onOpenChange={(o) => { if (o) setPerm(lerPermissao()); }}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full h-10 w-10 hover:bg-muted/50" title="Alertas de mensagem">
                    {tudoMudo ? <BellOff className="h-5 w-5 text-muted-foreground" /> : <Bell className="h-5 w-5 text-primary" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2 rounded-xl" align="end">
                <p className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Alertas de mensagem</p>
                {a && (
                    <div className="flex flex-col gap-0.5">
                        <Linha label="Som ao receber" checked={a.somRecebida} onChange={(v) => { muda({ somRecebida: v }); if (v) tocarRecebida(true); }} />
                        <Linha label="Som ao enviar" checked={a.somEnviada} onChange={(v) => { muda({ somEnviada: v }); if (v) tocarEnviada(true); }} />
                        <div className="px-2 py-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                                <span>Volume</span><span>{Math.round(a.volume * 100)}%</span>
                            </div>
                            <Slider value={[Math.round(a.volume * 100)]} min={5} max={100} step={5}
                                onValueChange={(v) => muda({ volume: (v[0] ?? 60) / 100 })}
                                onValueCommit={() => tocarRecebida(true)} />
                        </div>
                        <div className="my-1 border-t border-border/40" />
                        <Linha label="Ilha no topo da página" desc="Pop-up preto estilo Dynamic Island quando chega mensagem" checked={a.popup} onChange={(v) => muda({ popup: v })} />
                        <Linha label="Notificação do sistema" desc="Aparece no Windows quando você está em outra aba ou programa" checked={a.notifSistema} onChange={(v) => muda({ notifSistema: v })} />
                        {a.notifSistema && perm !== "granted" && (
                            <div className="mx-2 my-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug">
                                {perm === "inseguro" ? (
                                    <div className="space-y-2">
                                        <p>Pelo endereço <b>http</b> da rede o navegador bloqueia as notificações. Use o endereço <b>https</b>:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            <Button size="sm" className="h-7 text-xs" asChild><a href={enderecoHttps()}>Abrir em HTTPS</a></Button>
                                            <Button size="sm" variant="outline" className="h-7 text-xs" asChild><a href="/instalar-certificado-zaphub.bat" download>Instalar certificado</a></Button>
                                        </div>
                                        <p className="text-muted-foreground">Instale o certificado uma vez neste computador (para não aparecer aviso de segurança) e depois abra em HTTPS.</p>
                                    </div>
                                ) : perm === "indisponivel" ? (
                                    <>Este navegador não permite notificações aqui. Elas só funcionam em <b>https</b> ou em <b>localhost</b>.</>
                                ) : perm === "denied" ? (
                                    <>As notificações foram <b>bloqueadas</b>. Clique no cadeado ao lado do endereço → Notificações → Permitir.</>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="flex-1">Falta autorizar o navegador.</span>
                                        <Button size="sm" className="h-7 text-xs" onClick={pedirPermissao}>Permitir</Button>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="my-1 border-t border-border/40" />
                        <Button variant="ghost" size="sm" className="justify-start gap-2 h-9 text-sm"
                            title={temPip ? "Fica sempre por cima (Chrome/Edge)" : "Abre uma janela separada (seu navegador não tem 'sempre por cima')"}
                            onClick={() => window.dispatchEvent(new Event(EVENTO_ILHA_FLUTUANTE))}>
                            <PictureInPicture2 className="h-4 w-4 text-primary" />
                            <span className="flex-1 text-left">
                                Ilha flutuante
                                <span className="block text-[11px] text-muted-foreground font-normal">
                                    {temPip ? "Janelinha sempre por cima de qualquer aba ou programa" : "Abre uma janela separada (em qualquer navegador)"}
                                </span>
                            </span>
                        </Button>
                        <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-sm"
                            onClick={() => window.dispatchEvent(new Event(EVENTO_TESTAR_ALERTA))}>
                            <Play className="h-4 w-4 text-primary" /> Testar alerta
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
