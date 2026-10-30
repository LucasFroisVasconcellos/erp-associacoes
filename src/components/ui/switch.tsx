import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "data-checked:bg-success data-unchecked:bg-trilho focus-visible:ring-ring/35 aria-invalid:ring-destructive/20 aria-invalid:border-destructive shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:ring-4 aria-invalid:ring-4 group-has-[:focus-visible]/field-label:ring-0 data-[size=default]:h-[31px] data-[size=default]:w-[51px] data-[size=sm]:h-6 data-[size=sm]:w-10 peer group/switch relative inline-flex items-center transition-[color,background-color,border-color,box-shadow,opacity,transform,translate,scale] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[size=default]/switch:size-[27px] group-data-[size=sm]/switch:size-5 group-data-[size=default]/switch:data-checked:translate-x-5 group-data-[size=sm]/switch:data-checked:translate-x-4 group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 pointer-events-none block ring-0 transition-transform"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
