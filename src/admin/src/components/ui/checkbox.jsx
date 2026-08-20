import * as React from 'react'
import { cn } from '@/lib/utils'

// Native input rather than a Radix primitive: the only thing the primitive would
// buy here is styling, and `indeterminate` — which the Routes table header needs
// for a partial selection — is a DOM property with no attribute equivalent, so it
// has to be written through a ref either way.
const Checkbox = React.forwardRef(({ className, indeterminate = false, ...props }, ref) => {
  const inner = React.useRef(null)

  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      type="checkbox"
      ref={node => {
        inner.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      className={cn(
        'h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border border-input accent-primary',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})
Checkbox.displayName = 'Checkbox'

export { Checkbox }
