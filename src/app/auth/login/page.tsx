'use client';

import { useMemo, useState, useEffect, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ArrowRight, ArrowLeft, Loader2, Mail, X } from "lucide-react";
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AnimacaoLogin } from '@/components/auth/animacao-login';
import { SimboloZapHubAnimado } from '@/components/auth/simbolo-zaphub-animado';
import { destinoSeguro } from "@/lib/destino-seguro";

type LoginValues = { email: string; password: string; totp?: string };

// minha versao: "Login Fácil" — guarda SO os e-mails de quem ja logou neste navegador (nunca a senha).
// Util em terminal compartilhado: a pessoa clica no proprio e-mail e so digita a senha.
const CHAVE_LOGIN_FACIL = "zaphub-login-facil";
function lerEmailsSalvos(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_LOGIN_FACIL) || "[]");
    return Array.isArray(v) ? v.filter((e) => typeof e === "string") : [];
  } catch { return []; }
}
function salvarEmailLogin(email: string) {
  try {
    const atual = lerEmailsSalvos().filter((e) => e.toLowerCase() !== email.toLowerCase());
    atual.unshift(email);
    localStorage.setItem(CHAVE_LOGIN_FACIL, JSON.stringify(atual.slice(0, 6)));
  } catch { /* navegador sem storage */ }
}
function removerEmailLogin(email: string) {
  try {
    localStorage.setItem(CHAVE_LOGIN_FACIL, JSON.stringify(lerEmailsSalvos().filter((e) => e !== email)));
  } catch { /* ignora */ }
}

function LoginForm() {
  const t = useTranslations('auth');
  const tl = useTranslations('lgpd'); // minha versao: avisos de privacidade
  const formSchema = useMemo(() => z.object({
    email: z.string().email(t('invalidEmail')),
    password: z.string().min(1, t('login.passwordRequired')),
    totp: z.string().optional(),
  }), [t]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = destinoSeguro(searchParams.get('callbackUrl')); // minha versao: so caminho interno
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // minha versao: so mostra o campo do codigo DEPOIS de confirmar que aquela conta tem 2FA (login em 2 passos)
  const [precisa2fa, setPrecisa2fa] = useState(false);
  // minha versao: Login Fácil — e-mails lembrados neste navegador
  const [emailsSalvos, setEmailsSalvos] = useState<string[]>([]);
  useEffect(() => { setEmailsSalvos(lerEmailsSalvos()); }, []);

  const usarEmailSalvo = (email: string) => {
    form.setValue("email", email);
    setTimeout(() => { try { form.setFocus("password"); } catch {} }, 0);
  };
  const esquecerEmail = (email: string) => {
    removerEmailLogin(email);
    setEmailsSalvos(lerEmailsSalvos());
  };

  const form = useForm<LoginValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      totp: "",
    },
  });

  async function fazerLogin(values: LoginValues) {
    const result = await signIn('credentials', {
      redirect: false,
      email: values.email,
      password: values.password,
      totp: values.totp || "",
    });
    if (result?.error) {
      setError(t('login.invalidCredentials'));
      setPrecisa2fa(false); // recomeca do zero
    } else {
      salvarEmailLogin(values.email); // Login Fácil: lembra o e-mail (nunca a senha)
      window.location.href = callbackUrl;
      router.refresh();
    }
  }

  async function onSubmit(values: LoginValues) {
    setLoading(true);
    setError(null);
    try {
      if (!precisa2fa) {
        // etapa 1: confere e-mail+senha e descobre se a conta tem 2FA (sem criar sessao)
        let needs = false, bloqueado = false;
        try {
          const r = await fetch('/api/auth/precheck', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: values.email, password: values.password }),
          });
          const d = await r.json().catch(() => ({}));
          needs = !!d?.needs2fa; bloqueado = !!d?.bloqueado;
        } catch { /* se a pre-checagem falhar, cai no login normal abaixo */ }

        if (bloqueado) { setError("Muitas tentativas. Aguarde alguns minutos e tente de novo."); return; }
        if (needs) { setPrecisa2fa(true); return; }  // so agora aparece o campo do codigo
        await fazerLogin(values);                      // sem 2FA: entra direto (ou falha se a senha estava errada)
      } else {
        // etapa 2: a conta tem 2FA e o codigo ja foi digitado
        await fazerLogin(values);
      }
    } catch (err) {
      setError(t('unexpectedError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen relative overflow-hidden bg-background">
      {/* minha versao: mesma textura da pagina publica + volta ao inicio */}
      <div aria-hidden className="pointer-events-none absolute inset-0 chat-fundo opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <Link href="/" className="absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t('login.backHome')}
      </Link>
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>
      <div className="login-cartao relative z-10 w-full max-w-md p-4">
        <div className="flex flex-col items-center mb-8">
          {/* minha versao: o fundo de circuito (AnimacaoLogin) fica aqui dentro e se centra neste ladrilho = o hub */}
          <div className="relative mb-4">
            <AnimacaoLogin />
            {/* minha versao: icone do app (Z com nucleo em ambar sobre grafite); o Z se desenha ao carregar */}
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0D0E10] text-[#F4A935] shadow-lg shadow-black/30 ring-1 ring-white/10">
              <SimboloZapHubAnimado className="w-10" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('login.title')}</h1>
          <p className="text-muted-foreground mt-2">{t('login.subtitle', { appName: 'ZapHub' })}</p>
        </div>

        <div className="glass-panel rounded-3xl p-8 shadow-2xl shadow-black/5 dark:shadow-black/40 backdrop-blur-xl bg-background/60">
          {error && (
            <div role="alert" className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium animate-in shake duration-300">
              {error}
            </div>
          )}

          {/* minha versao: Login Fácil — atalhos de e-mail lembrados (sem senha) */}
          {!precisa2fa && emailsSalvos.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Login Fácil — clique no seu e-mail e só digite a senha
              </p>
              <p className="text-[11px] text-muted-foreground mb-2">{tl('loginEasyNotice')}</p>
              <div className="flex flex-wrap gap-2">
                {emailsSalvos.map((em) => (
                  <div key={em} className="group flex items-center gap-1 rounded-full border border-border/50 bg-background/50 pl-3 pr-1 py-1 text-xs hover:border-primary/40 transition-colors">
                    <button type="button" onClick={() => usarEmailSalvo(em)} className="max-w-[180px] truncate rounded text-foreground/80 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {em}
                    </button>
                    <button type="button" onClick={() => esquecerEmail(em)} title="Esquecer este e-mail" aria-label={`Esquecer o e-mail ${em}`} className="p-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">{t('email')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('emailPlaceholder')}
                        type="email"
                        autoComplete="username"
                        className="h-12 px-4 rounded-xl bg-background/50 border-border focus-visible:ring-primary/50 transition-all font-medium"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80">{t('password')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="h-12 px-4 rounded-xl bg-background/50 border-border focus-visible:ring-primary/50 transition-all font-medium"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* minha versao: codigo do app autenticador — so aparece DEPOIS da etapa 1, quando a conta tem 2FA */}
              {precisa2fa && (
                <FormField
                  control={form.control}
                  name="totp"
                  render={({ field }) => (
                    <FormItem className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <FormLabel className="text-foreground/80">Código de verificação</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          autoFocus
                          maxLength={6}
                          placeholder="000000"
                          className="h-12 px-4 rounded-xl bg-background/50 border-border focus-visible:ring-primary/50 transition-all font-medium tracking-[0.4em] text-center text-lg"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">Digite o código de 6 dígitos do seu app autenticador.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 rounded-xl text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 mt-2"
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t('login.submitting')}</>
                ) : (
                  <>{t('login.submit')} <ArrowRight className="ml-2 h-5 w-5" /></>
                )}
              </Button>
            </form>
          </Form>
        </div>

        {/* minha versao: modo demonstracao — acesso publico de teste */}
        {process.env.NEXT_PUBLIC_ZAPHUB_DEMO === "true" && (
          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-semibold text-foreground">Demonstração</p>
            <p className="mt-1 text-muted-foreground">Entre com <span className="font-mono text-foreground">demo@zaphub.demo</span> e a senha <span className="font-mono text-foreground">demo1234</span>. Os dados são fictícios e nada é enviado ao WhatsApp.</p>
          </div>
        )}

        <div className="mt-8 text-center text-sm text-muted-foreground">
          {t('login.noAccount')}{" "}
          <Link href="/auth/register" className="font-semibold text-primary hover:text-primary/80 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('login.createAccount')}
          </Link>
        </div>

        {/* minha versao: links legais discretos */}
        <nav aria-label="Documentos legais" className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/terms" className="underline-offset-2 hover:underline hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tl('termsLink')}</Link>
          <Link href="/privacy" className="underline-offset-2 hover:underline hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tl('privacyLink')}</Link>
        </nav>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
