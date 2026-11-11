import * as React from "react"

import { cn } from "@/lib/utils"

// minha versao: tipos onde o corretor atrapalha (senha, e-mail, numero, etc.) ficam SEM corretor
const SEM_CORRETOR = ["password", "email", "number", "tel", "url", "search", "date", "time", "datetime-local", "month", "week", "color"];

function Input({ className, type, lang, spellCheck, ...props }: React.ComponentProps<"input">) {
  const corrige = spellCheck ?? (type ? !SEM_CORRETOR.includes(type) : true);
  return (
    <input
      type={type}
      data-slot="input"
      // corretor nativo do navegador em pt-BR (desligado nos campos acima)
      lang={corrige ? (lang ?? "pt-BR") : lang}
      spellCheck={corrige}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
