import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import { conditionColors } from '../lib/palette'
import { welchP, zscore } from '../lib/stats'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

interface GeneSet { id: string; description: string; source: string; genes: string[] }
const MAX_HEATMAP = 120

// Search a gene LIST (paste) or a named gene SET (from the bundle's enrichment
// members), then show every gene's expression (z-scored heatmap) and DEG stats,
// plus a single module / signature score summarising the set per sample.
export default function GeneSetExplorer({ bundle, contrast, onSelectGene }: Props) {
  const { counts, meta } = bundle
  const S = counts.samples.length
  const [listText, setListText] = useState('')
  const [setQuery, setSetQuery] = useState('')
  const colors = conditionColors(meta.conditions)

  const sampleCond = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of bundle.samples) m[s.sample] = s.condition
    return m
  }, [bundle.samples])

  // Samples ordered by condition (control first), then name — shared x-axis order.
  const ordered = useMemo(() => {
    const colByName = new Map(counts.samples.map((s, j) => [s, j] as const))
    return [...counts.samples]
      .sort((a, b) => {
        const ca = meta.conditions.indexOf(sampleCond[a] ?? '')
        const cb = meta.conditions.indexOf(sampleCond[b] ?? '')
        return ca - cb || a.localeCompare(b)
      })
      .map(s => ({ sample: s, col: colByName.get(s)!, cond: sampleCond[s] ?? '?' }))
  }, [counts.samples, sampleCond, meta.conditions])

  // Named gene sets, sourced from enrichment members present in the bundle.
  const catalog = useMemo(() => {
    const map = new Map<string, GeneSet>()
    for (const rows of Object.values(bundle.enrichmentByContrast))
      for (const r of rows)
        if (r.geneID && !map.has(r.id))
          map.set(r.id, { id: r.id, description: r.description, source: r.source, genes: r.geneID.split('/').filter(Boolean) })
    return [...map.values()]
  }, [bundle.enrichmentByContrast])

  const setSuggestions = useMemo(() => {
    const q = setQuery.trim().toUpperCase()
    if (q.length < 2) return []
    return catalog.filter(s => s.description.toUpperCase().includes(q) || s.id.toUpperCase().includes(q)).slice(0, 10)
  }, [setQuery, catalog])

  const degMap = useMemo(() => {
    const m = new Map<string, DEGRow>()
    for (const r of bundle.degByContrast[contrast.id] || []) {
      m.set(r.gene_id.toUpperCase(), r)
      if (r.gene_name) m.set(r.gene_name.toUpperCase(), r)
    }
    return m
  }, [bundle.degByContrast, contrast.id])

  const tokens = useMemo(
    () => Array.from(new Set(listText.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean))),
    [listText])

  const resolved = useMemo(() => {
    const matched: { name: string; id: string; row: number }[] = []
    const unmatched: string[] = []
    const seen = new Set<number>()
    for (const t of tokens) {
      const i = counts.index.get(t.toUpperCase())
      if (i === undefined) { unmatched.push(t); continue }
      if (seen.has(i)) continue
      seen.add(i)
      matched.push({ name: counts.geneNames[i] || counts.geneIds[i], id: counts.geneIds[i], row: i })
    }
    matched.sort((a, b) =>
      (degMap.get(b.id.toUpperCase())?.log2FoldChange ?? 0) - (degMap.get(a.id.toUpperCase())?.log2FoldChange ?? 0))
    return { matched, unmatched }
  }, [tokens, counts, degMap])

  const matched = resolved.matched

  // z-score each matched gene across samples; module score = mean z per sample.
  const { zByGene, moduleByCol } = useMemo(() => {
    const zByGene = matched.map(g => {
      const base = g.row * S
      const logs = Array.from(counts.values.subarray(base, base + S)).map(v => Math.log2(v + 1))
      return zscore(logs)
    })
    const moduleByCol = new Array(S).fill(0)
    if (zByGene.length) for (let j = 0; j < S; j++) {
      let s = 0; for (const z of zByGene) s += z[j]
      moduleByCol[j] = s / zByGene.length
    }
    return { zByGene, moduleByCol }
  }, [matched, counts, S])

  const moduleByCond = useMemo(() => {
    const m: Record<string, number[]> = {}
    ordered.forEach(o => { (m[o.cond] ||= []).push(moduleByCol[o.col]) })
    return m
  }, [ordered, moduleByCol])

  const moduleStat = useMemo(() => {
    const a = moduleByCond[contrast.denominator] || []
    const b = moduleByCond[contrast.numerator] || []
    return a.length >= 2 && b.length >= 2 ? welchP(a, b) : null
  }, [moduleByCond, contrast])

  const pickSet = (s: GeneSet) => { setListText(s.genes.join(', ')); setSetQuery('') }

  // ── plots ────────────────────────────────────────────────────────────────
  const moduleTraces = meta.conditions
    .filter(c => moduleByCond[c]?.length)
    .map(c => ({
      type: 'box', name: c, y: moduleByCond[c],
      boxpoints: 'all', jitter: 0.5, pointpos: 0,
      marker: { color: colors[c], size: 7 }, line: { color: colors[c] }, fillcolor: colors[c] + '22',
    }))

  const shown = matched.slice(0, MAX_HEATMAP)
  const heatTrace = [{
    type: 'heatmap',
    z: shown.map((_, gi) => ordered.map(o => zByGene[gi][o.col])),
    x: ordered.map(o => o.sample),
    y: shown.map(g => g.name),
    colorscale: 'RdBu', reversescale: true, zmid: 0, zmin: -2.5, zmax: 2.5,
    colorbar: { title: 'z', thickness: 12, len: 0.6 },
    hovertemplate: '%{y} · %{x}<br>z %{z:.2f}<extra></extra>',
  }]

  return (
    <div className="space-y-4">
      {/* input */}
      <div className="card grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">Gene list</label>
          <textarea
            className="input h-24 w-full font-mono text-xs"
            placeholder="Paste genes — symbols or IDs, separated by space, comma or newline&#10;e.g.  TP53 MYC IL6 STAT1 CDKN1A BAX"
            value={listText}
            onChange={e => setListText(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <button className="btn py-1" onClick={() => setListText('TP53, MYC, IL6, STAT1, CDKN1A, BAX, BCL2, TNF, IFNG, CXCL10')}>Load example</button>
            <button className="btn py-1" onClick={() => setListText('')}>Clear</button>
          </div>
        </div>

        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Gene set search {catalog.length === 0 && <span className="text-xs font-normal text-slate-400">(no sets with members in this bundle)</span>}
          </label>
          <input
            className="input w-full"
            placeholder="Search a pathway / hallmark set…"
            value={setQuery}
            onChange={e => setSetQuery(e.target.value)}
            disabled={catalog.length === 0}
          />
          {setSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {setSuggestions.map(s => (
                <li key={s.id}>
                  <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-slate-700"
                    onClick={() => pickSet(s)}>
                    <span className="font-medium">{s.description}</span>
                    <span className="ml-1.5 text-xs text-slate-400">{s.source} · {s.genes.length} genes</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Picking a set fills the gene list on the left. Sets come from this bundle's enrichment results.
          </p>
        </div>
      </div>

      {tokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">
            <b>{matched.length}</b> of {tokens.length} genes found
          </span>
          {resolved.unmatched.length > 0 && (
            <span className="text-slate-400">· not in dataset: {resolved.unmatched.slice(0, 12).join(', ')}{resolved.unmatched.length > 12 ? '…' : ''}</span>
          )}
        </div>
      )}

      {matched.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          Paste a gene list or search a gene set to see per-gene expression, DEG statistics, and a module score.
        </div>
      ) : (
        <>
          {/* module score */}
          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Module score (mean z of {matched.length} genes)</h3>
              {moduleStat && (
                <span className="text-sm text-slate-500">
                  {contrast.numerator} vs {contrast.denominator}: Δ {moduleStat.diff.toFixed(2)} · p {fmtP(moduleStat.p)}
                </span>
              )}
            </div>
            <Plot
              data={moduleTraces}
              layout={{
                margin: { t: 8, r: 10, b: 36, l: 52 }, showlegend: false,
                yaxis: { title: 'module score', zeroline: true },
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { family: 'system-ui, sans-serif' },
              }}
              style={{ height: 320 }}
            />
          </div>

          {/* per-gene expression heatmap */}
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Per-gene expression — z-scored across samples{matched.length > MAX_HEATMAP ? ` (top ${MAX_HEATMAP} by log2FC)` : ''}
            </h3>
            <Plot
              data={heatTrace}
              layout={{
                margin: { t: 8, r: 10, b: 70, l: 90 },
                height: Math.max(220, shown.length * 16 + 120),
                xaxis: { tickangle: -45, automargin: true },
                yaxis: { automargin: true, tickfont: { size: 10 } },
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { family: 'system-ui, sans-serif' },
              }}
            />
          </div>

          {/* per-gene DEG stats */}
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Per-gene DEG statistics — {contrast.label}</h3>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2">Gene</th>
                    <th className="px-3 py-2 text-right">log2FC</th>
                    <th className="px-3 py-2 text-right">padj</th>
                    <th className="px-3 py-2">significance</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map(g => {
                    const d = degMap.get(g.id.toUpperCase())
                    const thr = contrast.padj_threshold ?? 0.05
                    return (
                      <tr key={g.id}
                        className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                        onClick={() => onSelectGene(g.name)}>
                        <td className="px-3 py-1.5 font-medium">{g.name}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {d ? d.log2FoldChange.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtP(d?.padj ?? null)}</td>
                        <td className="px-3 py-1.5">
                          {d && d.padj != null && d.padj < thr
                            ? <span className={`pill ${d.log2FoldChange > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                {d.log2FoldChange > 0 ? `↑ ${contrast.numerator}` : `↑ ${contrast.denominator}`}
                              </span>
                            : <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">n.s.</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">Click a gene to open it in the Gene expression tab.</p>
          </div>
        </>
      )}
    </div>
  )
}

function fmtP(p: number | null): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
