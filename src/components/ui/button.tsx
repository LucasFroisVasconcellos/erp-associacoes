import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "focus-visible:ring-ring/35 aria-invalid:ring-destructive/25 aria-invalid:border-destructive rounded-full border border-transparent bg-clip-padding font-semibold tracking-[-0.01em] transition-[transform,background-color,color,box-shadow,opacity] duration-150 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-4 aria-invalid:ring-4 active:not-aria-[haspopup]:scale-[0.97] motion-reduce:active:scale-100 [&_svg:not([class*='size-'])]:size-[18px] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,transform,translate,scale] outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
        outline: "border-border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-tint/12 text-tint hover:bg-tint/18 aria-expanded:bg-tint/18 dark:text-[color-mix(in_srgb,var(--tint)_70%,white)]",
        ghost: "text-tint hover:bg-tint/8 aria-expanded:bg-tint/8",
        destructive: "bg-destructive/12 text-destructive hover:bg-destructive/18 focus-visible:ring-destructive/30",
        link: "text-tint underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 gap-2 px-5 text-[17px] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 gap-1.5 px-4 text-[15px] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-[52px] gap-2 px-7 text-[17px]",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9",
        "icon-lg": "size-[52px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
