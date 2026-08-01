import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import type { AnalysisId, CiteStyle } from '../lib/methods'
import { DEFAULT_TITLE, bodySegments, buildDoc, renderHtml, renderPlain, useMethodsState } from '../lib/methods'

interface Props {
  bundle: Bundle
  contrast: Contrast
}

const ANALYSES: { id: AnalysisId; label: string }[] = [
  { id: 'de', label: 'Differential expression' },
  { id: 'ora', label: 'Enrichment' },
  { id: 'sets', label: 'Gene-set activity' },
  { id: 'ranking', label: 'Combined-score ranking' },
]

export default function Methods({ bundle, contrast }: Props) {
  const state = useMethodsState()
  // Combined-score ranking is off unless the manuscript reports that ranking.
  const [include, setInclude] = useState<Set<AnalysisId>>(new Set(['de', 'ora', 'sets']))
  const [style, setStyle] = useState<CiteStyle>('numbered')
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [copied, setCopied] = useState(false)

  const doc = useMemo(
    () => buildDoc(bundle, contrast, state, include, style, title.trim() || DEFAULT_TITLE),
    [bundle, contrast, state, include, style, title])
  const plain = renderPlain(doc)
  const isDemo = bundle.meta.engine === 'sample-generator'

  const toggle = (id: AnalysisId) => setInclude(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Copy both flavours: Word and Docs take text/html and keep real superscript;
  // anything else falls back to Unicode superscripts in text/plain.
  const copy = async () => {
    try {
      const html = renderHtml(doc)
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText(plain)
      }
      setCopied(true)
    } catch { setCopied(false) }
    setTimeout(() => setCopied(false), 1600)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([plain], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = `methods_${contrast.id}.txt`
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 800)
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Methods text</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              One paragraph, ready to paste into your manuscript, written from the cutoffs
              <b> currently set on your other tabs</b>. Change a threshold on Volcano, Enrichment or
              Gene sets and this follows. Check every number and reference before submitting.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy all'}</button>
            <button className="btn" onClick={download}>Download .txt</button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-400">heading</span>
            <input className="input w-48 py-1" value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-400">citations</span>
            <select className="input w-40 py-1" value={style} onChange={e => setStyle(e.target.value as CiteStyle)}>
              <option value="numbered">Numbered (1)</option>
              <option value="authoryear">Author–year</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-xs uppercase tracking-wide text-slate-400">include</span>
            {ANALYSES.map(a => (
              <label key={a.id} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={include.has(a.id)} onChange={() => toggle(a.id)} />
                {a.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {isDemo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          You are viewing the <b>simulated demo dataset</b> — this text describes fake data. Open your
          own bundle before using it.
        </div>
      )}

      {doc.engineUnknown && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          This bundle does not record which tool produced the results
          (<code className="font-mono text-xs">engine: "{bundle.meta.engine || '—'}"</code>), so the text
          leaves a bracketed placeholder. Replace it with your tool and add its citation.
        </div>
      )}

      {!!doc.unseen.length && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Showing <b>default</b> thresholds for {doc.unseen.join(', ')}. Open{' '}
          {doc.unseen.length > 1 ? 'those tabs' : 'that tab'} and set your cutoffs to have them read automatically.
        </div>
      )}

      <div className="card p-6">
        <article className="mx-auto max-w-[68ch]">
          <h3 className="text-sm font-semibold">{doc.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
            {bodySegments(doc.body).map((seg, i) =>
              seg.sup
                ? <sup key={i} className="font-medium text-indigo-600 dark:text-indigo-300">{seg.v}</sup>
                : <span key={i}>{seg.v}</span>)}
          </p>

          <h3 className="mt-6 text-sm font-semibold">References</h3>
          <ol className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
            {doc.refs.map(r => (
              <li key={r.n} className="flex gap-2">
                <span className="w-5 shrink-0 tabular-nums text-slate-400">{r.n}.</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ol>
          {!doc.refs.length && <p className="mt-2 text-sm text-slate-400">No tool citations for this bundle.</p>}
        </article>
      </div>

      <p className="text-xs text-slate-400">
        Database citations point to a recent release — update them to the version you actually used,
        and match the reference formatting to your journal's style.
      </p>
    </div>
  )
}
