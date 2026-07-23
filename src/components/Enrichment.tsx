import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow, EnrichmentRow } from '../types'
import { combinedScore } from '../lib/stats'
import { prepareSets, runORA } from '../lib/ora'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

const TOP_N = 15

export default function Enrichment({ bundle, contrast, onSelectGene }: Props) {
  const hasSets = !!bundle.genesets?.length
  const [mode, setMode] = useState<'pipeline' | 'custom'>('pipeline')
  const active = hasSets ? mode : 'pipeline'

  return (
    <div className="space-y-4">
      {hasSets && (
        <div className="flex gap-2">
          <button className={`tab ${active === 'pipeline' ? 'tab-active' : ''}`} onClick={() => setMode('pipeline')}>Pipeline results</button>
          <button className={`tab ${active === 'custom' ? 'tab-active' : ''}`} onClick={() => setMode('custom')}>Custom ORA (tunable)</button>
        </div>
      )}
      {active === 'pipeline'
        ? <PipelineEnrichment bundle={bundle} contrast={contrast} onSelectGene={onSelectGene} />
        : <CustomORA bundle={bundle} contrast={contrast} onSelectGene={onSelectGene} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Precomputed pipeline enrichment (ORA + GSEA) with term drill-down.
// ─────────────────────────────────────────────────────────────────────────────
function PipelineEnrichment({ bundle, contrast, onSelectGene }: Props) {
  const rows = bundle.enrichmentByContrast[contrast.id] || []
  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source))), [rows])
  const [source, setSource] = useState<string>('')
  const [termId, setTermId] = useState<string>('')
  const [rankByComb, setRankByComb] = useState(false)

  const activeSrc = source || sources[0] || ''
  const ranked = useMemo(
    () => rows.filter(r => r.source === activeSrc).sort((a, b) => (a.padj ?? 1) - (b.padj ?? 1)),
    [rows, activeSrc])
  const top = useMemo(() => ranked.slice(0, TOP_N), [ranked])

  const degMap = useMemo(() => buildDegMap(bundle.degByContrast[contrast.id]), [bundle.degByContrast, contrast.id])
  const { rankMap, totalRanked } = useMemo(() => buildRankMap(bundle.degByContrast[contrast.id]), [bundle.degByContrast, contrast.id])

  const selected: EnrichmentRow | undefined = ranked.find(r => r.id === termId) || top[0]

  if (rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-400">No enrichment results in this bundle for {contrast.label}.</div>
  }

  const bars = [...top].reverse()
  const isGsea = (selected?.method || '').toUpperCase() === 'GSEA'
  const members = selected?.geneID ? selected.geneID.split('/').filter(Boolean) : []
  const memberRows = members.map(g => {
    const d = degMap.get(g.toUpperCase())
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: rankMap.get(g.toUpperCase()) }
  })
  if (rankByComb) memberRows.sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity))

  return (
    <>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {sources.map(s => (
            <button key={s} className={`tab ${s === activeSrc ? 'tab-active' : ''}`} onClick={() => { setSource(s); setTermId('') }}>{s}</button>
          ))}
        </div>
        <Plot
          data={[barTrace(bars)]}
          layout={barLayout(bars.length)}
          onPointClick={p => p?.customdata && setTermId(p.customdata)}
          downloadName={`enrichment_${activeSrc.replace(/\W+/g, '_')}_${contrast.id}`}
        />
        <p className="mt-1 text-center text-xs text-slate-400">Bar length = gene count, colour = −log10 p.adjust. Click a bar to list its genes.</p>
      </div>

      {selected && (
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {selected.description}<span className="ml-2 font-mono text-xs normal-case text-slate-400">{selected.id} · {selected.source}</span>
            </h3>
            <span className="text-sm text-slate-500">{selected.count}/{selected.setSize} genes · padj {fmtP(selected.padj)} · {dirLabel(selected.direction)}</span>
          </div>

          {isGsea && (
            <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              GSEA ranks <b>all</b> genes — these leading-edge members need not be individually significant. For a
              DEG-threshold-based set, use <b>Custom ORA</b>.
            </p>
          )}

          {members.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">This term has no member-gene list in the bundle.</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-1.5 text-sm text-slate-500">
                <input type="checkbox" checked={rankByComb} onChange={e => setRankByComb(e.target.checked)} /> rank genes by combined score
              </label>
              <GeneStatTable rows={memberRows} contrast={contrast} totalRanked={totalRanked} onSelectGene={onSelectGene} showRank />
            </>
          )}
          <p className="mt-2 text-xs text-slate-400">
            <b>Combined score</b> = −log10(p-value) × log2FC. <b>Rank</b> = position among all {totalRanked.toLocaleString()} tested
            genes ranked by combined score. Click a gene to open it.
          </p>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom ORA — live hypergeometric over-representation from a tunable DEG list.
// ─────────────────────────────────────────────────────────────────────────────
function CustomORA({ bundle, contrast, onSelectGene }: Props) {
  const deg = bundle.degByContrast[contrast.id] || []
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(1)
  const [direction, setDirection] = useState<'both' | 'up' | 'down'>('both')
  const [minSize, setMinSize] = useState(10)
  const [maxSize, setMaxSize] = useState(500)
  const [selSources, setSelSources] = useState<Set<string>>(new Set())
  const [termId, setTermId] = useState<string>('')

  const degMap = useMemo(() => buildDegMap(deg), [deg])
  const { sets, universe } = useMemo(() => prepareSets(bundle.genesets || []), [bundle.genesets])
  const allSources = useMemo(() => Array.from(new Set(sets.map(s => s.source))), [sets])

  const background = useMemo(() => {
    const bg = new Set<string>()
    for (const r of deg) { const g = (r.gene_name || r.gene_id).toUpperCase(); if (universe.has(g)) bg.add(g) }
    return bg
  }, [deg, universe])

  const degUpper = useMemo(() => {
    const s = new Set<string>()
    for (const r of deg) {
      if (r.padj == null || r.padj > padjMax) continue
      if (Math.abs(r.log2FoldChange) < lfcMin) continue
      if (direction === 'up' && r.log2FoldChange <= 0) continue
      if (direction === 'down' && r.log2FoldChange >= 0) continue
      s.add((r.gene_name || r.gene_id).toUpperCase())
    }
    return s
  }, [deg, padjMax, lfcMin, direction])

  const results = useMemo(
    () => runORA(degUpper, sets, background, { minSize, maxSize, sources: selSources.size ? selSources : undefined }),
    [degUpper, sets, background, minSize, maxSize, selSources])

  const nDegInBg = useMemo(() => { let n = 0; for (const g of degUpper) if (background.has(g)) n++; return n }, [degUpper, background])
  const top = results.slice(0, TOP_N)
  const bars = [...top].reverse().map(r => ({ id: r.id, description: r.name, count: r.count, padj: r.padj }))
  const selected = results.find(r => r.id === termId) || results[0]

  const toggleSource = (s: string) => setSelSources(prev => {
    const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n
  })

  const memberRows = (selected?.overlap || []).map(g => {
    const d = degMap.get(g)
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: undefined as number | undefined }
  }).sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity))

  return (
    <>
      <div className="card p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Ctl label={`padj ≤ ${padjMax}`}>
            <input type="range" min={0} max={0.25} step={0.005} value={padjMax} onChange={e => setPadjMax(+e.target.value)} className="w-full" />
          </Ctl>
          <Ctl label={`|log2FC| ≥ ${lfcMin.toFixed(2)}`}>
            <input type="range" min={0} max={3} step={0.25} value={lfcMin} onChange={e => setLfcMin(+e.target.value)} className="w-full" />
          </Ctl>
          <Ctl label="direction">
            <select className="input w-full py-1" value={direction} onChange={e => setDirection(e.target.value as any)}>
              <option value="both">both</option>
              <option value="up">up in {contrast.numerator}</option>
              <option value="down">up in {contrast.denominator}</option>
            </select>
          </Ctl>
          <Ctl label="set size">
            <div className="flex items-center gap-1">
              <input type="number" className="input w-16 py-1" value={minSize} min={1} onChange={e => setMinSize(+e.target.value || 1)} />
              <span className="text-slate-400">–</span>
              <input type="number" className="input w-20 py-1" value={maxSize} min={1} onChange={e => setMaxSize(+e.target.value || 1)} />
            </div>
          </Ctl>
        </div>

        {allSources.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">sources:</span>
            {allSources.map(s => (
              <button key={s} onClick={() => toggleSource(s)}
                className={`pill border ${selSources.size === 0 || selSources.has(s) ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-200 text-slate-400 dark:border-slate-700'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-sm text-slate-500">
          <b>{degUpper.size.toLocaleString()}</b> DEGs at these thresholds ({nDegInBg.toLocaleString()} in the annotated background of {background.size.toLocaleString()}) ·
          <b> {results.length.toLocaleString()}</b> enriched sets (padj &lt; 0.05: {results.filter(r => r.padj < 0.05).length})
        </p>
      </div>

      {results.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          No sets pass with the current thresholds — loosen padj / log2FC, or widen the set-size range.
        </div>
      ) : (
        <>
          <div className="card p-4">
            <Plot
              data={[barTrace(bars)]}
              layout={barLayout(bars.length)}
              onPointClick={p => p?.customdata && setTermId(p.customdata)}
              downloadName={`custom_ORA_${contrast.id}`}
            />
            <p className="mt-1 text-center text-xs text-slate-400">Live over-representation (hypergeometric + BH). Click a bar to list its DEGs.</p>
          </div>

          {selected && (
            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {selected.name}<span className="ml-2 font-mono text-xs normal-case text-slate-400">{selected.id} · {selected.source}</span>
                </h3>
                <span className="text-sm text-slate-500">
                  {selected.count}/{selected.setSize} DEGs · fold {selected.foldEnrichment.toFixed(1)}× · padj {fmtP(selected.padj)}
                </span>
              </div>
              <GeneStatTable rows={memberRows} contrast={contrast} totalRanked={0} onSelectGene={onSelectGene} />
              <p className="mt-2 text-xs text-slate-400">
                These are the DEGs (padj ≤ {padjMax}, |log2FC| ≥ {lfcMin}) overlapping the set — all significant by construction.
              </p>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────
interface MemberRow { g: string; d: DEGRow | undefined; comb: number | null; rank: number | undefined }

function GeneStatTable({ rows, contrast, totalRanked, onSelectGene, showRank }: {
  rows: MemberRow[]; contrast: Contrast; totalRanked: number; onSelectGene: (g: string) => void; showRank?: boolean
}) {
  const thr = contrast.padj_threshold ?? 0.05
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2">Gene</th>
            <th className="px-3 py-2 text-right">log2FC</th>
            <th className="px-3 py-2 text-right">combined</th>
            {showRank && <th className="px-3 py-2 text-right">rank (all DEGs)</th>}
            <th className="px-3 py-2 text-right">padj</th>
            <th className="px-3 py-2">significance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ g, d, comb, rank }) => (
            <tr key={g} className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
              onClick={() => onSelectGene(g)}>
              <td className="px-3 py-1.5 font-medium">{g}</td>
              <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>{d ? d.log2FoldChange.toFixed(2) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono">{comb != null ? comb.toFixed(2) : '—'}</td>
              {showRank && <td className="px-3 py-1.5 text-right font-mono text-slate-500">{rank ? `${rank} / ${totalRanked}` : '—'}</td>}
              <td className="px-3 py-1.5 text-right font-mono">{fmtP(d?.padj ?? null)}</td>
              <td className="px-3 py-1.5">
                {d && d.padj != null && d.padj < thr
                  ? <span className={`pill ${d.log2FoldChange > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{d.log2FoldChange > 0 ? `↑ ${contrast.numerator}` : `↑ ${contrast.denominator}`}</span>
                  : <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">n.s.</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      {children}
    </div>
  )
}

function barTrace(bars: { id: string; description: string; count: number; padj: number | null }[]) {
  return {
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
  }
}
function barLayout(n: number) {
  return {
    margin: { t: 8, r: 20, b: 40, l: 300 }, height: Math.max(240, n * 26 + 80),
    xaxis: { title: 'gene count' }, yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
  }
}
function buildDegMap(rows?: DEGRow[]) {
  const m = new Map<string, DEGRow>()
  for (const r of rows || []) { m.set(r.gene_id.toUpperCase(), r); if (r.gene_name) m.set(r.gene_name.toUpperCase(), r) }
  return m
}
function buildRankMap(rows?: DEGRow[]) {
  const scored = (rows || []).map(r => ({ r, c: combinedScore(r.log2FoldChange, r.pvalue) }))
    .filter(x => x.c != null).sort((a, b) => (b.c as number) - (a.c as number))
  const rankMap = new Map<string, number>()
  scored.forEach((s, i) => { rankMap.set(s.r.gene_id.toUpperCase(), i + 1); if (s.r.gene_name) rankMap.set(s.r.gene_name.toUpperCase(), i + 1) })
  return { rankMap, totalRanked: scored.length }
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
function dirLabel(d: string) { return d === 'up' ? 'up-regulated' : d === 'down' ? 'down-regulated' : (d || 'mixed') }
function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
