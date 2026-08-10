import * as React from 'react'
import { cn } from '@/lib/utils'

function Progress({ value, className, ...props }) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress }
