import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-[72px] w-full resize-none rounded-[3px] border border-a-line-strong bg-a-surface px-3 py-2 text-[13px] leading-normal text-a-ink transition-colors outline-none placeholder:text-a-faint hover:border-a-faint focus-visible:border-a-accent focus-visible:shadow-[0_0_0_3px_var(--a-accent-ring)] disabled:cursor-not-allowed disabled:border-a-line disabled:bg-a-bg disabled:text-a-faint aria-invalid:border-q-do",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
