import Button from './Button'

export default function Pagination({
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
  itemLabel = 'result',
}: {
  page: number
  totalPages: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
  itemLabel?: string
}) {
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
      <span>
        {totalCount} {itemLabel}
        {totalCount === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onPrev} disabled={page === 0}>
          Previous
        </Button>
        <span className="tabular-nums">
          Page {page + 1} of {Math.max(totalPages, 1)}
        </span>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={page >= totalPages - 1}>
          Next
        </Button>
      </div>
    </div>
  )
}
