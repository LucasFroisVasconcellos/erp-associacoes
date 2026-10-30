import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "bg-muted border-transparent focus-visible:bg-card focus-visible:border-ring/60 focus-visible:ring-ring/25 aria-invalid:ring-destructive/20 aria-invalid:border-destructive disabled:opacity-60 h-11 rounded-xl border px-3.5 py-2 text-[17px] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground file:h-7 file:text-sm file:font-medium focus-visible:ring-4 aria-invalid:ring-4 md:text-[15px] w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
