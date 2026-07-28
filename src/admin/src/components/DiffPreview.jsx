// Git-diff-style renderer for pending route changes.
// D-06: additions in green on top, removals in red below; omit whichever
// block is empty. Presentation-only — no data fetching.

export default function DiffPreview({ additions = [], removals = [] }) {
  if (additions.length === 0 && removals.length === 0) {
    return <p className="text-muted-foreground text-sm font-mono py-1">No pending changes</p>
  }

  return (
    <div className="font-mono text-xs rounded-md border border-border bg-muted/30 p-3 space-y-0.5">
      {additions.length > 0 && additions.map(e => (
        <div key={`add-${e.cidr}`} className="text-green-600 dark:text-green-400">
          + {e.cidr}{e.description ? `  # ${e.description}` : ''}
        </div>
      ))}
      {removals.length > 0 && removals.map(e => (
        <div key={`rem-${e.cidr}`} className="text-red-600 dark:text-red-400">
          - {e.cidr}{e.description ? `  # ${e.description}` : ''}
        </div>
      ))}
    </div>
  )
}
