import { auth } from "@/lib/auth";
import { Navbar } from "@/components/dashboard/navbar";
import { SessionProvider } from "@/components/dashboard/session-provider";
import { SidebarProvider } from "@/components/dashboard/sidebar-context";
import { SidebarShell } from "@/components/dashboard/sidebar-shell";
import { UpdateChecker } from "@/components/dashboard/update-checker";
import { RegistrationWarning } from "@/components/dashboard/registration-warning";
import { Notificador } from "@/components/dashboard/notificador";
import { prisma } from "@/lib/prisma";
import { Toaster } from "sonner";
import pkg from "../../../package.json";
import { AVISO_DEMO, MENSAGEM_DEMO } from "@/lib/demo";


export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    // @ts-ignore
    const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    const appName = systemConfig?.appName || "ZapHub";
    const registrationEnabled = systemConfig?.enableRegistration ?? true;

    return (
        <SessionProvider>
            <SidebarProvider>
                <UpdateChecker />
                <Notificador />
                {AVISO_DEMO && (
                    <div role="status" className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg">
                        Demonstração: dados fictícios. {MENSAGEM_DEMO}
                    </div>
                )}
                <RegistrationWarning
                    role={session?.user?.role as string}
                    registrationEnabled={registrationEnabled}
                />
                <div className="flex h-screen bg-background relative overflow-hidden" suppressHydrationWarning={true}>
                    {/* Subtle ambient background */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" suppressHydrationWarning={true}>
                        <div className="absolute -top-[20%] -left-[10%] w-[35rem] h-[35rem] bg-primary/[0.03] rounded-full blur-[100px]" />
                        <div className="absolute -bottom-[20%] -right-[10%] w-[25rem] h-[25rem] bg-primary/[0.03] rounded-full blur-[80px]" />
                    </div>

                    {/* Sidebar */}
                    <SidebarShell
                        appName={appName}
                        userName={session?.user?.name}
                        userEmail={session?.user?.email}
                        version={pkg.version}
                    />

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative z-10" suppressHydrationWarning={true}>
                        <Navbar appName={appName} />
                        <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 styled-scrollbar">
                            {children}
                        </main>
                    </div>
                    {/* minha versao: os avisos seguem o tema do ZapHub (o tema e a classe .dark, que o sonner nao enxerga sozinho) */}
                    <Toaster toastOptions={{ classNames: { toast: "!bg-popover !text-popover-foreground !border-border", description: "!text-muted-foreground", actionButton: "!bg-primary !text-primary-foreground" } }} />
                </div>
            </SidebarProvider>
        </SessionProvider>
    );
}
