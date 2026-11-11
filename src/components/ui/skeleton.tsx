import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent skeleton-brilho rounded-md" /* minha versao: brilho ambar (era animate-pulse) */, className)}
      {...props}
    />
  )
}

export { Skeleton }
