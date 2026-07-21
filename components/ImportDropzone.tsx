'use client'

import { useState, useCallback } from 'react'
import { UploadCloud } from 'lucide-react'
import type { ImportResult } from '@/lib/types'
import Panel from '@/components/ui/Panel'
import Badge from '@/components/ui/Badge'
import Alert from '@/components/ui/Alert'
import { buttonBase, buttonSizes, buttonVariants } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

export default function ImportDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleFiles = useCallback(async (files: FileList) => {
    setUploading(true)
    setErrorMessage(null)
    const newResults: ImportResult[] = []

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()

        if (!res.ok) {
          setErrorMessage(`${file.name}: ${data.error || 'Import failed.'}`)
          continue
        }
        newResults.push(data as ImportResult)
      } catch {
        setErrorMessage(`${file.name}: Network error during upload.`)
      }
    }

    setResults((prev) => [...newResults, ...prev])
    setUploading(false)
  }, [])

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors',
          isDragging ? 'border-accent-500 bg-accent-50' : 'border-slate-300 bg-white hover:border-slate-400'
        )}
      >
        <UploadCloud className="h-8 w-8 text-slate-400" />
        <p className="text-sm font-medium text-slate-700">
          Drag SAP report files here
        </p>
        <p className="-mt-2 text-xs text-slate-400">
          .XLS exports from CTM or Italtile — brand is detected automatically from the filename
        </p>
        <label className={cn(buttonBase, buttonSizes.md, buttonVariants.primary, 'cursor-pointer')}>
          {uploading ? 'Uploading…' : 'Choose files'}
          <input
            type="file"
            multiple
            accept=".xls,.XLS"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFiles(e.target.files)
                e.target.value = ''
              }
            }}
          />
        </label>
      </div>

      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Import results
            <Badge tone="neutral">{results.length}</Badge>
          </h2>
          {results.map((r, i) => (
            <Panel key={i} className="flex items-center justify-between text-sm">
              <div>
                <Badge tone={r.brand === 'CTM' ? 'ctm' : 'ital'} className="mr-2">
                  {r.brand}
                </Badge>
                <span className="text-slate-600">{r.filename}</span>
              </div>
              <div className="text-slate-500">
                {r.inserted} added
                {r.duplicates > 0 && `, ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} skipped`}
                {r.errors.length > 0 && (
                  <span className="ml-2 text-amber-600">
                    · {r.errors.length} row issue{r.errors.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
