import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import { conditionColors } from '../lib/palette'
import { mean, welchP, zscore } from '../lib/stats'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
}

interface ScoredSet {
  name: string
  nInput: number
  nMatched: number
  moduleByCol: number[]      // module score per sample column (data order)
}

const EXAMPLE = `Inflammation: TP53, IL6, TNF, IFNG, CXCL10, STAT1, NFKB1
Proliferation: MYC, MKI67, CCND1, EGFR, KRAS
Apoptosis: BAX, BCL2, CDKN1A, PTEN, SOD2`

// Compare the ACTIVITY of several user-defined gene sets. Each set gets a module
// score (mean of per-gene z-scores) per sample; we compare those scores across
// sets and conditions. Per-gene detail lives in the Gene expression tab.
export default function GeneSetExplorer({ bundle, contrast }: Props) {
  const { counts, meta } = bundle
  const S = counts.samples.length
  const [text, setText] = useState('')
  const colors = conditionColors(meta.conditions)

  const sampleCond = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of bundle.samples) m[s.sample] = s.condition
    return m
  }, [bundle.samples])

  const ordered = useMemo(() => {
    const colByName = new Map(counts.samples.map((s, j) => [s, j] as const))
    return [...counts.samples]
      .sort((a, b) => (meta.conditions.indexOf(sampleCond[a] ?? '') - meta.conditions.indexOf(sampleCond[b] ?? '')) || a.localeCompare(b))
      .map(s => ({ sample: s, col: colByName.get(s)!, cond: sampleCond[s] ?? '?' }))
  }, [counts.samples, sampleCond, meta.conditions])

  // Parse "Name: G1, G2, …" lines into scored sets.
  const sets = useMemo<ScoredSet[]>(() => {
    const out: ScoredSet[] = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const ci = t.indexOf(':')
      const name = ci > 0 ? t.slice(0, ci).trim() : `Set ${out.length + 1}`
      const body = ci > 0 ? t.slice(ci + 1) : t
      const tokens = Array.from(new Set(body.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)))
      const rows: number[] = []
      const seen = new Set<number>()
      for (const tok of tokens) {
        const i = counts.index.get(tok.toUpperCase())
        if (i !== undefined && !seen.has(i)) { seen.add(i); rows.push(i) }
      }
      const z = rows.map(r => zscore(Array.from(counts.values.subarray(r * S, r * S + S)).map(v => Math.log2(v + 1))))
      const moduleByCol = new Array(S).fill(0)
      if (z.length) for (let j = 0; j < S; j++) { let s = 0; for (const zr of z) s += zr[j]; moduleByCol[j] = s / z.length }
      out.push({ name, nInput: tokens.length, nMatched: rows.length, moduleByCol })
    }
    return out.filter(s => s.nMatched > 0)
  }, [text, counts, S])

  // Grouped box: module score by set, grouped by condition.
  const boxTraces = useMemo(() => {
    const per: Record<string, { x: string[]; y: number[] }> = {}
    for (const set of sets)
      for (const o of ordered) {
        (per[o.cond] ||= { x: [], y: [] })
        per[o.cond].x.push(set.name)
        per[o.cond].y.push(set.moduleByCol[o.col])
      }
    return meta.conditions.filter(c => per[c]).map(c => ({
      type: 'box', name: c, x: per[c].x, y: per[c].y,
      boxpoints: 'all', jitter: 0.4, pointpos: 0,
      marker: { color: colors[c], size: 6 }, line: { color: colors[c] },
    }))
  }, [sets, ordered, meta.conditions, colors])

  // Activity heatmap: sets × samples.
  const heatTrace = useMemo(() => ([{
    type: 'heatmap',
    z: sets.map(set => ordered.map(o => set.moduleByCol[o.col])),
    x: ordered.map(o => o.sample), y: sets.map(s => s.name),
    colorscale: 'RdBu', reversescale: true, zmid: 0,
    colorbar: { title: 'module<br>score', thickness: 12, len: 0.7 },
    hovertemplate: '%{y} · %{x}<br>score %{z:.2f}<extra></extra>',
  }]), [sets, ordered])

  // Full statistics per set (per-condition means + numerator-vs-denominator test).
  const stats = useMemo(() => sets.map(set => {
    const byCond: Record<string, number[]> = {}
    ordered.forEach(o => { (byCond[o.cond] ||= []).push(set.moduleByCol[o.col]) })
    const a = byCond[contrast.denominator] || []
    const b = byCond[contrast.numerator] || []
    const test = a.length >= 2 && b.length >= 2 ? welchP(a, b) : null
    return { set, byCond, test }
  }), [sets, ordered, contrast])

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
          Define gene sets — one per line, <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Name: GENE1, GENE2, …</code>
        </label>
        <textarea
          className="input h-28 w-full font-mono text-xs"
          placeholder={EXAMPLE}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button className="btn py-1" onClick={() => setText(EXAMPLE)}>Load example</button>
          <button className="btn py-1" onClick={() => setText('')}>Clear</button>
          {sets.length > 0 && <span className="text-slate-400">{sets.length} set{sets.length > 1 ? 's' : ''} scored · module score = mean z of member genes</span>}
        </div>
      </div>

      {sets.length === 0 ? (
        <div className="card p-12 text-center text-sm text-slate-400">
          Define one or more gene sets above to compare their activity across conditions.
        </div>
      ) : (
        <>
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Set activity by condition</h3>
            <Plot data={boxTraces} layout={{
              margin: { t: 8, r: 10, b: 50, l: 52 }, boxmode: 'group',
              yaxis: { title: 'module score', zeroline: true },
              legend: { orientation: 'h', y: 1.12, x: 0 },
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
            }} style={{ height: 380 }} />
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Activity matrix — sets × samples</h3>
            <Plot data={heatTrace} layout={{
              margin: { t: 8, r: 10, b: 70, l: 130 }, height: Math.max(180, sets.length * 34 + 120),
              xaxis: { tickangle: -45, automargin: true }, yaxis: { automargin: true },
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
            }} />
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Module-score statistics — {contrast.numerator} vs {contrast.denominator}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Gene set</th>
                    <th className="px-3 py-2 text-right">genes</th>
                    {meta.conditions.map(c => <th key={c} className="px-3 py-2 text-right">mean {c}</th>)}
                    <th className="px-3 py-2 text-right">Δ ({contrast.numerator}−{contrast.denominator})</th>
                    <th className="px-3 py-2 text-right">t</th>
                    <th className="px-3 py-2 text-right">p</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(({ set, byCond, test }) => (
                    <tr key={set.name} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5 font-medium">{set.name}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{set.nMatched}/{set.nInput}</td>
                      {meta.conditions.map(c => (
                        <td key={c} className="px-3 py-1.5 text-right font-mono">
                          {byCond[c]?.length ? mean(byCond[c]).toFixed(2) : '—'}
                        </td>
                      ))}
                      <td className={`px-3 py-1.5 text-right font-mono ${test && test.diff > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {test ? test.diff.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{test ? test.t.toFixed(2) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{test ? fmtP(test.p) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Δ and p compare each set's module score between {contrast.numerator} and {contrast.denominator} (Welch test).
              Per-gene expression &amp; statistics: use the Gene expression tab.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
