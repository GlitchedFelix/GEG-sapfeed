'use client'

import { useState, useCallback } from 'react'
import type { ImportResult } from '@/lib/types'

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
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'
        }`}
      >
        <p className="mb-2 text-sm font-medium text-slate-700">
          Drag SAP report files here
        </p>
        <p className="mb-4 text-xs text-slate-400">
          .XLS exports from CTM or Italtile — brand is detected automatically from the filename
        </p>
        <label className="cursor-pointer rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
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

      {errorMessage && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
          {errorMessage}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Import results</h2>
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <div>
                <span
                  className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                    r.brand === 'CTM' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                  }`}
                >
                  {r.brand}
                </span>
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
