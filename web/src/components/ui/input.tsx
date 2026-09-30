import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[34px] w-full min-w-0 rounded-[3px] border border-a-line-strong bg-a-surface px-3 text-[13px] leading-normal text-a-ink transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-a-ink placeholder:text-a-faint hover:border-a-faint focus-visible:border-a-accent focus-visible:shadow-[0_0_0_3px_var(--a-accent-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-a-line disabled:bg-a-bg disabled:text-a-faint aria-invalid:border-q-do aria-invalid:focus-visible:shadow-[0_0_0_3px_rgba(229,72,77,0.26)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
