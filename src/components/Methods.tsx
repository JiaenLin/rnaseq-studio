import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import type { SectionId } from '../lib/methods'
import { buildSections, renderMethods, useMethodsState } from '../lib/methods'

interface Props {
  bundle: Bundle
  contrast: Contrast
}

export default function Methods({ bundle, contrast }: Props) {
  const state = useMethodsState()
  const sections = useMemo(() => buildSections(bundle, contrast, state), [bundle, contrast, state])
  // Everything is included except "Gene ranking" — the combined-score definition
  // is only needed if the manuscript actually reports that ranking.
  const [off, setOff] = useState<Set<SectionId>>(new Set(['ranking']))
  const [copied, setCopied] = useState(false)

  const chosen = useMemo(
    () => new Set(sections.map(s => s.id).filter(id => !off.has(id))),
    [sections, off])
  const text = renderMethods(sections, chosen)
  const isDemo = bundle.meta.engine === 'sample-generator'

  const toggle = (id: SectionId) => setOff(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
    setTimeout(() => setCopied(false), 1600)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = `methods_${contrast.id}.txt`
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 800)
  }

  const unseen = sections.filter(s => chosen.has(s.id) && !s.live)

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Methods text</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              A draft Methods paragraph for your manuscript, written from the thresholds
              <b> currently set on your other tabs</b>. Change a cutoff on Volcano, Enrichment or
              Gene sets and this updates. Check every number before submitting.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button className="btn" onClick={download}>Download .txt</button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-xs uppercase tracking-wide text-slate-400">include</span>
          {sections.map(s => (
            <label key={s.id} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
              {s.heading}
            </label>
          ))}
        </div>
      </div>

      {isDemo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          You are viewing the <b>simulated demo dataset</b> — this text describes fake data. Open your
          own bundle before using it.
        </div>
      )}

      {!!unseen.length && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Showing <b>default</b> thresholds for: {unseen.map(s => s.heading).join(', ')}. Open{' '}
          {unseen.length > 1 ? 'those tabs' : 'that tab'} and set your cutoffs to have them read automatically.
        </div>
      )}

      <div className="card p-6">
        <article className="mx-auto max-w-[68ch] space-y-4 leading-relaxed">
          {sections.filter(s => chosen.has(s.id)).map(s => (
            <section key={s.id}>
              <h3 className="text-sm font-semibold">{s.heading}</h3>
              {/* pre-line so the multi-line reference list keeps its breaks */}
              <p className="mt-1 whitespace-pre-line text-[15px] text-slate-700 dark:text-slate-200">{s.body}</p>
            </section>
          ))}
          {!chosen.size && <p className="text-center text-sm text-slate-400">Select at least one section above.</p>}
        </article>
      </div>

      <p className="text-xs text-slate-400">
        Cite the analysis engine and any gene-set databases you used in addition to RNA-seq Studio.
        Thresholds, counts and set totals above are read from this bundle and your current settings.
      </p>
    </div>
  )
}
