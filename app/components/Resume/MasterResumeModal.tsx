'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, FileText, Upload, Loader2, ArrowLeft } from 'lucide-react'
import type { ResumeVersion } from '@/lib/types'

interface MasterResumeModalProps {
  editingMaster:    ResumeVersion | null
  masterForm:       { variant_name: string; content: string; make_default: boolean }
  setMasterForm:    React.Dispatch<React.SetStateAction<{ variant_name: string; content: string; make_default: boolean }>>
  uploadMode:       'file' | 'paste'
  setUploadMode:    (m: 'file' | 'paste') => void
  selectedFile:     File | null
  dragActive:       boolean
  extracting:       boolean
  extractedText:    string | null
  setExtractedText: (t: string | null) => void
  savingMaster:     boolean
  onClose:          () => void
  onSave:           (e: React.FormEvent) => void
  onDrag:           (e: React.DragEvent) => void
  onDrop:           (e: React.DragEvent) => void
  onFileChange:     (f: File) => void
  onResetFile:      () => void
}

interface UploadSectionProps {
  extractedText: string | null
  selectedFile: File | null
  extracting: boolean
  onResetFile: () => void
  setExtractedText: (t: string | null) => void
  onDrag: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onFileChange: (f: File) => void
  dragActive: boolean
}

function UploadSection({
  extractedText,
  selectedFile,
  extracting,
  onResetFile,
  setExtractedText,
  onDrag,
  onDrop,
  onFileChange,
  dragActive,
}: UploadSectionProps) {
  if (extractedText !== null) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            <span className="font-medium truncate max-w-[200px]">{selectedFile?.name}</span>
          </div>
          <button type="button" onClick={onResetFile} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Change file
          </button>
        </div>
        <p className="text-xs text-muted-foreground">This is exactly what Claude will read. Edit anything that looks wrong.</p>
        <textarea
          value={extractedText}
          onChange={(e) => setExtractedText(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[300px] resize-y font-mono"
        />
      </div>
    )
  }

  if (extracting) {
    return (
      <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div>
          <p className="text-sm font-medium">Extracting text...</p>
          <p className="text-xs text-muted-foreground mt-0.5">{selectedFile?.name}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={onDrag} onDrop={onDrop}
      className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}`}
    >
      <input
        type="file" accept=".pdf,.docx"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f) }}
      />
      <div className="space-y-2 pointer-events-none">
        <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">Drop your resume here</p>
        <p className="text-xs text-muted-foreground">PDF or DOCX - or click to browse</p>
      </div>
    </div>
  )
}

export function MasterResumeModal({
  editingMaster, masterForm, setMasterForm, uploadMode, setUploadMode,
  selectedFile, dragActive, extracting, extractedText, setExtractedText,
  savingMaster, onClose, onSave, onDrag, onDrop, onFileChange, onResetFile,
}: MasterResumeModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-4 flex-shrink-0">
          <CardTitle>{editingMaster ? 'Edit Master Resume' : 'Add Master Resume'}</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </CardHeader>
        <form onSubmit={onSave} className="flex flex-col flex-1 overflow-hidden">
          <CardContent className="space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input required value={masterForm.variant_name} onChange={(e) => setMasterForm(f => ({ ...f, variant_name: e.target.value }))} placeholder="e.g. Software Engineering, PhD Applications" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Resume Content *</Label>
                {!editingMaster && (
                  <div className="flex gap-1 bg-muted p-0.5 rounded-md">
                    <button type="button" onClick={() => { setUploadMode('file'); onResetFile() }} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${uploadMode === 'file' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>Upload File</button>
                    <button type="button" onClick={() => setUploadMode('paste')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${uploadMode === 'paste' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>Paste Text</button>
                  </div>
                )}
              </div>
              {(!editingMaster && uploadMode === 'file') ? (
                <UploadSection
                  extractedText={extractedText}
                  selectedFile={selectedFile}
                  extracting={extracting}
                  onResetFile={onResetFile}
                  setExtractedText={setExtractedText}
                  onDrag={onDrag}
                  onDrop={onDrop}
                  onFileChange={onFileChange}
                  dragActive={dragActive}
                />
              ) : (
                <textarea
                  required={uploadMode === 'paste' || !!editingMaster}
                  value={masterForm.content}
                  onChange={(e) => setMasterForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Paste your full resume text here..."
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[300px] resize-y font-mono"
                />
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={masterForm.make_default} onChange={(e) => setMasterForm(f => ({ ...f, make_default: e.target.checked }))} />
              <span className="text-sm">Set as default master resume</span>
            </label>
            <Button type="submit" className="w-full" disabled={savingMaster || extracting || (uploadMode === 'file' && !editingMaster && extractedText === null)}>
              {savingMaster ? 'Saving...' : editingMaster ? 'Save Changes' : 'Add Master Resume'}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
