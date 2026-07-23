import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
}

const TOP_N = 15

export default function Enrichment({ bundle, contrast }: Props) {
  const rows = bundle.enrichmentByContrast[contrast.id] || []
  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source))), [rows])
  const [source, setSource] = useState<string>('')

  const active = source || sources[0] || ''
  const subset = useMemo(() => {
    return rows
      .filter(r => r.source === active)
      .sort((a, b) => (a.padj ?? 1) - (b.padj ?? 1))
      .slice(0, TOP_N)
      .reverse() // Plotly draws first at the bottom; we want smallest padj on top
  }, [rows, active])

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-400">
        No enrichment results in this bundle for {contrast.label}.
        <div className="mt-1 text-xs">Enrichment is optional — the DE tables above are unaffected.</div>
      </div>
    )
  }

  const useScore = subset.some(r => r.score != null)
  const trace = [{
    type: 'scatter', mode: 'markers',
    x: subset.map(r => (useScore ? r.score : r.count) ?? 0),
    y: subset.map(r => truncate(r.description, 42)),
    text: subset.map(r => `${r.id}<br>${r.count}/${r.setSize} genes<br>padj ${fmtP(r.padj)}`),
    hovertemplate: '%{y}<br>%{text}<extra></extra>',
    marker: {
      size: subset.map(r => 8 + Math.sqrt(r.count) * 3),
      color: subset.map(r => -Math.log10(Math.max(r.padj ?? 1, 1e-300))),
      colorscale: 'YlOrRd', reversescale: false, showscale: true,
      colorbar: { title: '−log10<br>padj', thickness: 12, len: 0.6 },
      line: { color: '#64748b', width: 0.5 },
    },
  }]

  const layout = {
    margin: { t: 10, r: 20, b: 45, l: 280 },
    height: Math.max(260, subset.length * 26 + 90),
    xaxis: { title: useScore ? 'enrichment score / NES' : 'gene count' },
    yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, sans-serif' },
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {sources.map(s => (
          <button key={s} className={`tab ${s === active ? 'tab-active' : ''}`} onClick={() => setSource(s)}>{s}</button>
        ))}
      </div>
      <Plot data={trace} layout={layout} />
      <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">Term</th><th className="px-3 py-2">Dir</th>
              <th className="px-3 py-2 text-right">Count</th><th className="px-3 py-2 text-right">padj</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter(r => r.source === active).sort((a, b) => (a.padj ?? 1) - (b.padj ?? 1)).slice(0, 100).map((r, i) => (
              <tr key={r.id + i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5"><span className="font-medium">{r.description}</span>
                  <span className="ml-1.5 font-mono text-xs text-slate-400">{r.id}</span></td>
                <td className="px-3 py-1.5">{dirPill(r.direction)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{r.count}/{r.setSize}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtP(r.padj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function dirPill(d: string) {
  if (d === 'up') return <span className="pill bg-red-100 text-red-700">up</span>
  if (d === 'down') return <span className="pill bg-blue-100 text-blue-700">down</span>
  return <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">{d || '—'}</span>
}
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
function fmtP(p: number | null): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
