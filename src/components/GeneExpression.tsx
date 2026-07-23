import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import { geneRow } from '../lib/bundle'
import { conditionColors } from '../lib/palette'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  selectedGene: string | null
  onSelectGene: (gene: string) => void
}

// Search any gene and see its normalized expression distribution per condition,
// with the DEG statistics for the active contrast surfaced alongside.
export default function GeneExpression({ bundle, contrast, selectedGene, onSelectGene }: Props) {
  const [query, setQuery] = useState('')
  const [log2, setLog2] = useState(true)
  const { counts, meta } = bundle

  // Sample → condition lookup, and the display order (control first).
  const sampleCond = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of bundle.samples) m[s.sample] = s.condition
    return m
  }, [bundle.samples])

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (q.length < 1) return []
    const hits: string[] = []
    for (let i = 0; i < counts.geneNames.length && hits.length < 10; i++) {
      const nm = counts.geneNames[i]
      const id = counts.geneIds[i]
      if ((nm && nm.toUpperCase().startsWith(q)) || id.toUpperCase().startsWith(q)) {
        hits.push(nm || id)
      }
    }
    return hits
  }, [query, counts])

  const gene = selectedGene ?? ''
  const found = gene ? geneRow(counts, gene) : null
  const deg = useMemo(() => {
    if (!found) return null
    const rows = bundle.degByContrast[contrast.id] || []
    const id = counts.geneIds[found.row]
    const nm = counts.geneNames[found.row]
    return rows.find(r => r.gene_id === id || (nm && r.gene_name === nm)) || null
  }, [found, bundle, contrast, counts])

  const colors = conditionColors(meta.conditions)

  const traces = useMemo(() => {
    if (!found) return []
    const byCond: Record<string, number[]> = {}
    counts.samples.forEach((s, j) => {
      const c = sampleCond[s] ?? 'unknown'
      const v = found.values[j]
      ;(byCond[c] ||= []).push(log2 ? Math.log2(v + 1) : v)
    })
    const order = meta.conditions.filter(c => byCond[c]?.length)
    return order.map(c => ({
      type: 'box', name: c, y: byCond[c],
      boxpoints: 'all', jitter: 0.5, pointpos: 0, marker: { color: colors[c], size: 7 },
      line: { color: colors[c] }, fillcolor: colors[c] + '22',
    }))
  }, [found, counts, sampleCond, log2, meta.conditions, colors])

  const layout = useMemo(() => ({
    margin: { t: 10, r: 10, b: 40, l: 56 },
    showlegend: false,
    yaxis: { title: log2 ? 'log2(normalized + 1)' : 'normalized counts', zeroline: false },
    xaxis: { title: '' },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, sans-serif' },
  }), [log2])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card p-4">
        <div className="relative mb-3 flex items-center gap-2">
          <input
            className="input w-64"
            placeholder="Search a gene (symbol or ID)…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && suggestions[0]) { onSelectGene(suggestions[0]); setQuery('') } }}
          />
          <label className="ml-2 flex items-center gap-1.5 text-sm text-slate-500">
            <input type="checkbox" checked={log2} onChange={e => setLog2(e.target.checked)} /> log2 scale
          </label>
          {suggestions.length > 0 && (
            <ul className="absolute left-0 top-9 z-10 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {suggestions.map(s => (
                <li key={s}>
                  <button
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-slate-700"
                    onClick={() => { onSelectGene(s); setQuery('') }}
                  >{s}</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!found && (
          <p className="py-16 text-center text-sm text-slate-400">
            {gene ? `“${gene}” not found in this dataset.` : 'Search for a gene to see its expression across groups.'}
          </p>
        )}
        {found && <Plot data={traces} layout={layout} />}
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {gene || '—'}
        </h3>
        {deg ? (
          <dl className="space-y-2 text-sm">
            <Stat label="log2 fold change" value={deg.log2FoldChange?.toFixed(3)}
              hint={`${contrast.numerator} vs ${contrast.denominator}`} />
            <Stat label="adj. p-value (BH)" value={fmtP(deg.padj)} />
            <Stat label="p-value" value={fmtP(deg.pvalue)} />
            <Stat label="base mean" value={deg.baseMean?.toFixed(1)} />
            <div className="pt-2">
              {sig(deg.padj, deg.log2FoldChange, contrast)}
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">
            {found ? 'No differential-expression row for this gene in the active contrast.' : 'DEG statistics appear here.'}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}{hint && <span className="ml-1 text-xs text-slate-400">({hint})</span>}</dt>
      <dd className="font-mono font-medium">{value ?? '—'}</dd>
    </div>
  )
}

function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}

function sig(padj: number | null, lfc: number, c: Contrast) {
  const thr = c.padj_threshold ?? 0.05
  if (padj == null) return <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">not tested</span>
  if (padj >= thr) return <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">not significant</span>
  const up = lfc > 0
  return (
    <span className={`pill ${up ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
      ▲ significant — higher in {up ? c.numerator : c.denominator}
    </span>
  )
}
