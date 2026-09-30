import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * DS Checkbox (Checkbox.jsx): a 16px box, 1.5px `--border-strong`, 3px radius, brand fill
 * with a white tick when checked, 8px to its 13px label.
 */
function Checkbox({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-start gap-2 text-[13px] leading-normal text-a-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-a-faint", className)}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className="mt-px flex size-4 flex-shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-a-line-strong bg-a-surface text-white transition-colors duration-[120ms] peer-checked:border-a-accent peer-checked:bg-a-accent peer-focus-visible:shadow-[0_0_0_3px_var(--a-accent-ring)] [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
      >
        <Check className="size-3" strokeWidth={1.75} />
      </span>
      {label}
    </label>
  )
}

export { Checkbox }
