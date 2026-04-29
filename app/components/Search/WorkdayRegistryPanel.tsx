'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface RegistryEntry {
  key:    string
  tenant: string
  dc:     string
  site:   string
}

export function WorkdayRegistryPanel() {
  const [open, setOpen]           = useState(false)
  const [entries, setEntries]     = useState<RegistryEntry[]>([])
  const [loading, setLoading]     = useState(false)
  const [removing, setRemoving]   = useState<string | null>(null)

  // Add-by-URL
  const [urlInput, setUrlInput]   = useState('')
  const [addingUrl, setAddingUrl] = useState(false)

  // Add manually
  const [manualKey,    setManualKey]    = useState('')
  const [manualTenant, setManualTenant] = useState('')
  const [manualDc,     setManualDc]     = useState('')
  const [manualSite,   setManualSite]   = useState('')
  const [addingManual, setAddingManual] = useState(false)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/workday-registry')
      if (res.ok) setEntries(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && entries.length === 0) fetchEntries()
  }, [open, entries.length, fetchEntries])

  async function addByUrl() {
    if (!urlInput.trim()) return
    setAddingUrl(true)
    try {
      const res  = await fetch('/api/workday-registry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed to add'); return }
      toast.success(`Added "${data.key}" to the registry`)
      setUrlInput('')
      setEntries([])   // force re-fetch so the list is fresh
      fetchEntries()
    } finally {
      setAddingUrl(false)
    }
  }

  async function addManual() {
    if (!manualKey || !manualTenant || !manualDc || !manualSite) return
    setAddingManual(true)
    try {
      const res  = await fetch('/api/workday-registry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: manualKey.trim(), tenant: manualTenant.trim(), dc: manualDc.trim(), site: manualSite.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed to add'); return }
      toast.success(`Added "${data.key}" to the registry`)
      setManualKey(''); setManualTenant(''); setManualDc(''); setManualSite('')
      setEntries([])
      fetchEntries()
    } finally {
      setAddingManual(false)
    }
  }

  async function removeEntry(key: string) {
    setRemoving(key)
    try {
      const res  = await fetch(`/api/workday-registry?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed to remove'); return }
      toast.success(`Removed "${key}" from registry`)
      setEntries(prev => prev.filter(e => e.key !== key))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium"
      >
        <div className="flex items-center gap-2">
          <span>Workday company registry</span>
          <Badge variant="secondary" className="text-xs font-normal">{entries.length > 0 ? `${entries.length} companies` : 'global'}</Badge>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border border-t-0 rounded-b-lg px-4 pb-4 pt-3 space-y-4">
          <p className="text-xs text-muted-foreground">
            Companies listed here are auto-discovered when you type their name in Target Companies on any config. No URL needed.
          </p>

          {/* Table */}
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading registry…
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[28%]">Company key</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[22%]">Tenant</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[12%]">DC</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Site</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((e) => (
                    <tr key={e.key} className="hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-medium">{e.key}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{e.tenant}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{e.dc}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground truncate max-w-[160px]">{e.site}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removeEntry(e.key)}
                          disabled={removing === e.key}
                          className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                          title={`Remove ${e.key}`}
                        >
                          {removing === e.key
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Trash2 className="h-3 w-3" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <hr className="border-border" />

          {/* Add by URL */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Add by URL</p>
            <p className="text-xs text-muted-foreground">Paste the company's Workday career page URL — tenant details are extracted automatically.</p>
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://{tenant}.{dc}.myworkdayjobs.com/{site}"
                className="font-mono text-xs h-8"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addByUrl() } }}
              />
              <Button type="button" size="sm" onClick={addByUrl} disabled={addingUrl || !urlInput.trim()} className="gap-1 h-8">
                {addingUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add
              </Button>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">e.g. https://bosch.wd3.myworkdayjobs.com/Bosch_Extern</p>
          </div>

          <hr className="border-border" />

          {/* Add manually */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Or add manually</p>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Company key</label>
                <Input value={manualKey}    onChange={(e) => setManualKey(e.target.value)}    placeholder="e.g. bosch"        className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Tenant slug</label>
                <Input value={manualTenant} onChange={(e) => setManualTenant(e.target.value)} placeholder="e.g. bosch"        className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">DC</label>
                <Input value={manualDc}     onChange={(e) => setManualDc(e.target.value)}     placeholder="e.g. wd3"          className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Site name</label>
                <Input value={manualSite}   onChange={(e) => setManualSite(e.target.value)}   placeholder="e.g. Bosch_Extern" className="text-xs h-8" />
              </div>
            </div>
            <Button
              type="button" size="sm" onClick={addManual}
              disabled={addingManual || !manualKey || !manualTenant || !manualDc || !manualSite}
              className="gap-1 h-8"
            >
              {addingManual ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Save to registry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
