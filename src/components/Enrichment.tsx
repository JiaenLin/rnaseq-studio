import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow, EnrichmentRow } from '../types'
import { combinedScore } from '../lib/stats'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

const TOP_N = 15

export default function Enrichment({ bundle, contrast, onSelectGene }: Props) {
  const rows = bundle.enrichmentByContrast[contrast.id] || []
  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source))), [rows])
  const [source, setSource] = useState<string>('')
  const [termId, setTermId] = useState<string>('')
  const [rankByComb, setRankByComb] = useState(false)

  const active = source || sources[0] || ''
  const ranked = useMemo(
    () => rows.filter(r => r.source === active).sort((a, b) => (a.padj ?? 1) - (b.padj ?? 1)),
    [rows, active])
  const top = useMemo(() => ranked.slice(0, TOP_N), [ranked])

  // DEG lookup for the active contrast, to annotate genes under a term.
  const degMap = useMemo(() => {
    const m = new Map<string, DEGRow>()
    for (const r of bundle.degByContrast[contrast.id] || []) {
      m.set(r.gene_id.toUpperCase(), r)
      if (r.gene_name) m.set(r.gene_name.toUpperCase(), r)
    }
    return m
  }, [bundle.degByContrast, contrast.id])

  // Global rank of every gene in the FULL DEG table, by combined score (desc).
  const { rankMap, totalRanked } = useMemo(() => {
    const scored = (bundle.degByContrast[contrast.id] || [])
      .map(r => ({ r, c: combinedScore(r.log2FoldChange, r.pvalue) }))
      .filter(x => x.c != null)
      .sort((a, b) => (b.c as number) - (a.c as number))
    const rankMap = new Map<string, number>()
    scored.forEach((s, i) => {
      rankMap.set(s.r.gene_id.toUpperCase(), i + 1)
      if (s.r.gene_name) rankMap.set(s.r.gene_name.toUpperCase(), i + 1)
    })
    return { rankMap, totalRanked: scored.length }
  }, [bundle.degByContrast, contrast.id])

  const selected: EnrichmentRow | undefined =
    ranked.find(r => r.id === termId) || top[0]

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-400">
        No enrichment results in this bundle for {contrast.label}.
        <div className="mt-1 text-xs">Enrichment is optional — the DE tables are unaffected.</div>
      </div>
    )
  }

  // clusterProfiler-style barplot: bar length = gene count, colour = adjusted p.
  // Reverse so the most-significant term sits at the top.
  const bars = [...top].reverse()
  const barTrace = [{
    type: 'bar', orientation: 'h',
    x: bars.map(t => t.count),
    y: bars.map(t => truncate(t.description, 44)),
    customdata: bars.map(t => t.id),
    text: bars.map(t => `padj ${fmtP(t.padj)}`),
    hovertemplate: '%{y}<br>count %{x}<br>%{text}<extra></extra>',
    marker: {
      color: bars.map(t => -Math.log10(Math.max(t.padj ?? 1, 1e-300))),
      colorscale: 'YlOrRd', showscale: true,
      colorbar: { title: '−log10<br>p.adjust', thickness: 12, len: 0.6 },
      line: { color: '#64748b', width: 0.5 },
    },
  }]

  const members = selected?.geneID ? selected.geneID.split('/').filter(Boolean) : []
  const memberRows = members.map(g => {
    const d = degMap.get(g.toUpperCase())
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: rankMap.get(g.toUpperCase()) }
  })
  if (rankByComb) memberRows.sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity))

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {sources.map(s => (
            <button key={s} className={`tab ${s === active ? 'tab-active' : ''}`}
              onClick={() => { setSource(s); setTermId('') }}>{s}</button>
          ))}
        </div>
        <Plot
          data={barTrace}
          layout={{
            margin: { t: 8, r: 20, b: 40, l: 300 },
            height: Math.max(240, bars.length * 26 + 80),
            xaxis: { title: 'gene count' },
            yaxis: { automargin: true, tickfont: { size: 11 } },
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { family: 'system-ui, sans-serif' },
          }}
          onPointClick={p => p?.customdata && setTermId(p.customdata)}
          downloadName={`enrichment_${active.replace(/\W+/g, '_')}_${contrast.id}`}
        />
        <p className="mt-1 text-center text-xs text-slate-400">Bar length = gene count, colour = −log10 p.adjust. Click a bar to list the genes under that term.</p>
      </div>

      {selected && (
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {selected.description}
              <span className="ml-2 font-mono text-xs normal-case text-slate-400">{selected.id} · {selected.source}</span>
            </h3>
            <span className="text-sm text-slate-500">
              {selected.count}/{selected.setSize} genes · padj {fmtP(selected.padj)} · {dirLabel(selected.direction)}
            </span>
          </div>

          {members.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">This term has no member-gene list in the bundle.</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-1.5 text-sm text-slate-500">
                <input type="checkbox" checked={rankByComb} onChange={e => setRankByComb(e.target.checked)} />
                rank genes by combined score
              </label>
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2">Gene</th>
                      <th className="px-3 py-2 text-right">log2FC</th>
                      <th className="px-3 py-2 text-right">combined</th>
                      <th className="px-3 py-2 text-right">rank (all DEGs)</th>
                      <th className="px-3 py-2 text-right">padj</th>
                      <th className="px-3 py-2">significance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map(({ g, d, comb, rank }) => {
                      const thr = contrast.padj_threshold ?? 0.05
                      return (
                        <tr key={g}
                          className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                          onClick={() => onSelectGene(g)}>
                          <td className="px-3 py-1.5 font-medium">{g}</td>
                          <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                            {d ? d.log2FoldChange.toFixed(2) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">{comb != null ? comb.toFixed(2) : '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                            {rank ? `${rank} / ${totalRanked}` : '—'}
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
            </>
          )}
          <p className="mt-2 text-xs text-slate-400">
            <b>Combined score</b> = −log10(p-value) × log2FC. <b>Rank</b> = the gene's position among all {totalRanked.toLocaleString()} tested
            genes when the full DEG table is ranked by combined score (1 = most up-regulated &amp; significant). Click a gene to open it.
          </p>
        </div>
      )}
    </div>
  )
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
function dirLabel(d: string) { return d === 'up' ? 'up-regulated' : d === 'down' ? 'down-regulated' : (d || 'mixed') }
function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
