'use client'

export function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="text-sm space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="font-bold text-base mt-3 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('## ')) return <h2 key={i} className="font-bold text-lg mt-4 mb-1">{line.slice(3)}</h2>
        if (line.startsWith('# ')) return <h1 key={i} className="font-bold text-xl mt-4 mb-1">{line.slice(2)}</h1>
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="pl-4">&bull; {line.slice(2)}</p>
        if (line.match(/^\d+\.\s/)) return <p key={i} className="pl-4">{line}</p>
        if (line.trim() === '') return <div key={i} className="h-1" />
        const parts = line.split(/\*\*(.*?)\*\*/g)
        if (parts.length > 1) {
          return (
            <p key={i}>
              {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
            </p>
          )
        }
        return <p key={i}>{line}</p>
      })}
    </div>
  )
}
