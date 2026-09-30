import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * DS Switch (Switch.jsx): a 34×20 track (sm 28×16), `--gray-300` off and brand on, with a
 * 16px (sm 12px) white thumb inset 2px that slides 14px (sm 12px) in 180ms.
 */
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-0 p-0 transition-colors duration-[180ms] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:shadow-[0_0_0_3px_var(--a-accent-ring)] data-[size=default]:h-5 data-[size=default]:w-[34px] data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:bg-a-accent data-unchecked:bg-a-line-strong data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-[var(--a-shadow-sm)] ring-0 transition-transform duration-[180ms] group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:translate-x-0.5 group-data-[size=sm]/switch:translate-x-0.5 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
