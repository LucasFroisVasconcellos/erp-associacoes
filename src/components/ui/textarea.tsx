import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "bg-muted border-transparent focus-visible:bg-card focus-visible:border-ring/60 focus-visible:ring-ring/25 aria-invalid:ring-destructive/20 aria-invalid:border-destructive disabled:opacity-60 min-h-24 rounded-xl border px-3.5 py-2.5 text-[17px] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:ring-4 aria-invalid:ring-4 md:text-[15px] flex field-sizing-content min-h-16 w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
