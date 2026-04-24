'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, Plus, Star, Trash2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ResumeVersion, JobWithScore, AnalysisResult } from '@/lib/types'

import { MarkdownBlock }           from '@/app/components/Resume/MarkdownBlock'
import { MasterResumeModal }       from '@/app/components/Resume/MasterResumeModal'
import { AnalyzeJobModal }         from '@/app/components/Resume/AnalyzeJobModal'
import { AnalysisResultsSection }  from '@/app/components/Resume/AnalysisResultsSection'
import { PastAnalysesList }        from '@/app/components/Resume/PastAnalysesList'

type AnalysisTab = 'job' | 'company' | 'gap' | 'resume' | 'prep' | 'cover'
type ResumeMode  = 'conservative' | 'aggressive'

const STEPS = [
  { id: 'job',     label: 'Analyzing job description...' },
  { id: 'company', label: 'Researching company news...' },
  { id: 'gap',     label: 'Comparing resume to role...' },
  { id: 'resume',  label: 'Tailoring resume (x2 modes)...' },
  { id: 'prep',    label: 'Building interview briefing...' },
  { id: 'cover',   label: 'Writing cover letter...' },
  { id: 'done',    label: 'Done!' },
]

export default function ResumePage() {
  const [masters, setMasters]       = useState<ResumeVersion[]>([])
  const [versions, setVersions]     = useState<ResumeVersion[]>([])
  const [flaggedJobs, setFlaggedJobs] = useState<JobWithScore[]>([])
  const [loading, setLoading]       = useState(true)

  // Master modal state
  const [showMasterModal, setShowMasterModal] = useState(false)
  const [editingMaster, setEditingMaster]     = useState<ResumeVersion | null>(null)
  const [masterForm, setMasterForm]           = useState({ variant_name: '', content: '', make_default: false })
  const [savingMaster, setSavingMaster]       = useState(false)
  const [uploadMode, setUploadMode]           = useState<'file' | 'paste'>('file')
  const [selectedFile, setSelectedFile]       = useState<File | null>(null)
  const [dragActive, setDragActive]           = useState(false)
  const [extracting, setExtracting]           = useState(false)
  const [extractedText, setExtractedText]     = useState<string | null>(null)

  // Analyze modal state
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false)
  const [analyzeForm, setAnalyzeForm] = useState({
    masterId: '', jobInputMode: 'paste' as 'paste' | 'flagged',
    jobDescription: '', selectedJobId: '', runCompanySearch: true, companySearchQuery: '',
  })
  const [analyzing, setAnalyzing]   = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState(0)

  // Results state
  const [results, setResults]             = useState<AnalysisResult | null>(null)
  const [activeTab, setActiveTab]         = useState<AnalysisTab>('job')
  const [resumeMode, setResumeMode]       = useState<ResumeMode>('conservative')
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)
  const [versionTab, setVersionTab]       = useState<Record<string, AnalysisTab | ResumeMode>>({})

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (analyzeForm.jobInputMode === 'paste' && analyzeForm.jobDescription) {
      const match =
        analyzeForm.jobDescription.match(/(?:at|@)\s+([A-Z][a-zA-Z\s&,.']+?)(?:\n|,|\.|--|-)/) ??
        analyzeForm.jobDescription.match(/^([A-Z][a-zA-Z\s&]+?)(?:\n|is hiring|seeks)/)
      if (match) setAnalyzeForm(f => ({ ...f, companySearchQuery: `"${match[1].trim()}" news 2025 OR 2026` }))
    }
  }, [analyzeForm.jobDescription])

  useEffect(() => {
    if (analyzeForm.jobInputMode === 'flagged' && analyzeForm.selectedJobId) {
      const job = flaggedJobs.find(j => j.id === analyzeForm.selectedJobId)
      if (job) setAnalyzeForm(f => ({ ...f, companySearchQuery: `"${job.company}" news 2025 OR 2026`, jobDescription: job.description ?? '' }))
    }
  }, [analyzeForm.selectedJobId, analyzeForm.jobInputMode])

  useEffect(() => {
    if (showAnalyzeModal && masters.length > 0) {
      const def = masters.find(m => m.is_default) ?? masters[0]
      setAnalyzeForm(f => ({ ...f, masterId: def.id }))
    }
  }, [showAnalyzeModal, masters])

  async function fetchAll() {
    setLoading(true)
    const [mr, vr, jr] = await Promise.all([fetch('/api/resume/masters'), fetch('/api/resume/versions'), fetch('/api/jobs?recommended=true&limit=50')])
    const [md, vd, jd] = await Promise.all([mr.json(), vr.json(), jr.json()])
    if (mr.ok) setMasters(md)
    if (vr.ok) setVersions(vd)
    if (jr.ok) setFlaggedJobs(jd)
    setLoading(false)
  }

  async function handleFileSelect(file: File) {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) { toast.error('Only PDF and DOCX files are supported'); return }
    setSelectedFile(file); setExtractedText(null); setExtracting(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/resume/extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        setExtractedText(data.text)
        if (!masterForm.variant_name.trim()) setMasterForm(f => ({ ...f, variant_name: file.name.replace(/\.(pdf|docx)$/i, '').replace(/[_-]+/g, ' ').trim() }))
      } else { toast.error(data.error ?? 'Failed to extract text from file'); setSelectedFile(null) }
    } catch { toast.error('Failed to extract text - check your connection'); setSelectedFile(null) }
    finally { setExtracting(false) }
  }

  function resetFileState() { setSelectedFile(null); setExtractedText(null); setExtracting(false) }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    const file = e.dataTransfer.files[0]; if (file) handleFileSelect(file)
  }

  async function handleSaveMaster(e: React.FormEvent) {
    e.preventDefault()
    if (!editingMaster) {
      if (uploadMode === 'file' && (!selectedFile || extracting || !extractedText?.trim())) { toast.error('Please upload and wait for text extraction'); return }
      if (uploadMode === 'paste' && !masterForm.content.trim()) { toast.error('Please paste your resume content'); return }
    }
    setSavingMaster(true)
    if (editingMaster) {
      const res = await fetch(`/api/resume/masters/${editingMaster.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant_name: masterForm.variant_name, content: masterForm.content, ...(masterForm.make_default ? { is_default: true } : {}) }) })
      const data = await res.json()
      if (res.ok) { setMasters(prev => prev.map(m => { if (masterForm.make_default) return m.id === editingMaster.id ? { ...data } : { ...m, is_default: false }; return m.id === editingMaster.id ? data : m })); toast.success('Resume updated'); closeMasterModal() }
      else toast.error(data.error)
    } else {
      const content = uploadMode === 'file' ? (extractedText ?? '') : masterForm.content
      const res = await fetch('/api/resume/masters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant_name: masterForm.variant_name, content, make_default: masterForm.make_default }) })
      const data = await res.json()
      if (res.ok) { setMasters(prev => { const u = masterForm.make_default ? prev.map(m => ({ ...m, is_default: false })) : prev; return [...u, data] }); toast.success('Master resume saved'); closeMasterModal() }
      else toast.error(data.error)
    }
    setSavingMaster(false)
  }

  async function handleSetDefault(id: string) {
    const res = await fetch(`/api/resume/masters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) })
    if (res.ok) { setMasters(prev => prev.map(m => ({ ...m, is_default: m.id === id }))); toast.success('Default resume set') }
  }

  async function handleDeleteMaster(id: string) {
    if (!confirm('Delete this master resume?')) return
    const res = await fetch(`/api/resume/masters/${id}`, { method: 'DELETE' })
    if (res.ok) setMasters(prev => prev.filter(m => m.id !== id))
  }

  function openEditMaster(master: ResumeVersion) {
    setEditingMaster(master); setMasterForm({ variant_name: master.variant_name ?? '', content: master.content ?? '', make_default: master.is_default }); setUploadMode('paste'); resetFileState(); setShowMasterModal(true)
  }

  function closeMasterModal() {
    setShowMasterModal(false); setEditingMaster(null); setMasterForm({ variant_name: '', content: '', make_default: false }); setUploadMode('file'); setDragActive(false); resetFileState()
  }

  async function handleRunAnalysis(e: React.FormEvent) {
    e.preventDefault()
    if (!analyzeForm.masterId) { toast.error('Please select a master resume'); return }
    const jd = analyzeForm.jobInputMode === 'paste' ? analyzeForm.jobDescription : flaggedJobs.find(j => j.id === analyzeForm.selectedJobId)?.description ?? ''
    if (!jd.trim()) { toast.error('Please provide a job description'); return }
    setAnalyzing(true); setResults(null); setAnalyzeStep(0)
    const stepInterval = setInterval(() => setAnalyzeStep(prev => { const max = analyzeForm.runCompanySearch ? 5 : 4; return prev < max ? prev + 1 : prev }), 5000)
    const res = await fetch('/api/resume/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterId: analyzeForm.masterId, jobDescription: jd, jobId: analyzeForm.jobInputMode === 'flagged' ? analyzeForm.selectedJobId : null, runCompanySearch: analyzeForm.runCompanySearch, companySearchQuery: analyzeForm.runCompanySearch ? analyzeForm.companySearchQuery : null }) })
    clearInterval(stepInterval); setAnalyzeStep(STEPS.length - 1); setAnalyzing(false)
    const data = await res.json()
    if (res.ok) { setResults(data); setActiveTab('job'); setShowAnalyzeModal(false); await fetchAll(); toast.success('Analysis complete!') }
    else toast.error(data.error ?? 'Analysis failed')
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Resume</h2>
          <p className="text-muted-foreground mt-1">Manage master resumes and generate AI-tailored versions</p>
        </div>
        <Button onClick={() => setShowAnalyzeModal(true)} disabled={masters.length === 0} className="gap-2">
          <Sparkles className="h-4 w-4" /> Analyze a Job
        </Button>
      </div>

      {/* Master Resumes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">Master Resumes</h3>
          <Button variant="outline" size="sm" onClick={() => setShowMasterModal(true)} className="gap-1"><Plus className="h-3 w-3" /> Add Master</Button>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : masters.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="font-medium text-sm">No master resumes yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add a master resume to start analyzing jobs</p>
              <Button variant="outline" size="sm" onClick={() => setShowMasterModal(true)} className="mt-3 gap-1"><Plus className="h-3 w-3" /> Add Master Resume</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {masters.map((m) => (
              <Card key={m.id} className={`transition-shadow hover:shadow-sm ${m.is_default ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="py-4 px-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <p className="font-medium text-sm truncate">{m.variant_name}</p>
                    </div>
                    {m.is_default && <Badge variant="secondary" className="text-xs flex-shrink-0">Default</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{m.content?.slice(0, 120)}...</p>
                  <div className="flex items-center gap-2 pt-1">
                    {!m.is_default && <button onClick={() => handleSetDefault(m.id)} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"><Star className="h-3 w-3" /> Set default</button>}
                    <button onClick={() => openEditMaster(m)} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Edit</button>
                    <button onClick={() => handleDeleteMaster(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {results && (
        <AnalysisResultsSection
          results={results} activeTab={activeTab} setActiveTab={setActiveTab}
          resumeMode={resumeMode} setResumeMode={setResumeMode}
          onCopy={(text) => { navigator.clipboard.writeText(text); toast.success('Copied to clipboard') }}
        />
      )}

      <PastAnalysesList
        versions={versions} expandedVersion={expandedVersion} setExpandedVersion={setExpandedVersion}
        versionTab={versionTab} setVersionTab={setVersionTab}
      />

      {showMasterModal && (
        <MasterResumeModal
          editingMaster={editingMaster} masterForm={masterForm} setMasterForm={setMasterForm}
          uploadMode={uploadMode} setUploadMode={setUploadMode} selectedFile={selectedFile}
          dragActive={dragActive} extracting={extracting} extractedText={extractedText}
          setExtractedText={setExtractedText} savingMaster={savingMaster}
          onClose={closeMasterModal} onSave={handleSaveMaster}
          onDrag={handleDrag} onDrop={handleDrop} onFileChange={handleFileSelect} onResetFile={resetFileState}
        />
      )}

      {showAnalyzeModal && (
        <AnalyzeJobModal
          masters={masters} flaggedJobs={flaggedJobs} analyzing={analyzing}
          analyzeStep={analyzeStep} analyzeForm={analyzeForm} setAnalyzeForm={setAnalyzeForm}
          onClose={() => setShowAnalyzeModal(false)} onSubmit={handleRunAnalysis}
        />
      )}
    </div>
  )
}
