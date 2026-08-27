import { useEffect, useMemo, useRef, useState } from 'react'
import type { Contrast, DEGRow } from '../types'
import type { SetIndex } from '../lib/genesets.ts'
import type { GseaResult, RankMetric } from '../lib/gsea'
import { RANK_METRICS, canRank, rankGenes, runGsea, runningCurve, setsFromIndex } from '../lib/gsea'
import { SIG_COLORS, contrastTitle } from '../lib/palette'
import { reportGsea, useReport } from '../lib/methods'
import Plot from '../lib/Plot'

interface Props {
  deg: DEGRow[]
  contrast: Contrast
  /** The enabled library, already folded against this contrast's background. */
  index: SetIndex | null
  minSize: number
  maxSize: number
  onSelectGene: (gene: string) => void
}

const PERMS = [200, 1000, 5000]

/**
 * Pre-ranked GSEA, on the same library ORA is testing.
 *
 * Kept in its own component because it is a different kind of control surface,
 * not a different set of numbers: ORA is live and follows a slider, GSEA is a
 * few seconds of permutation and has to be ASKED for. Mixing the two would give
 * the enrichment card a threshold that silently costs three seconds on every
 * drag, or a Run button that half the controls ignore.
 */
export default function Gsea({ deg, contrast, index, minSize, maxSize, onSelectGene }: Props) {
  /**
   * The default is the Wald statistic, and it falls back rather than failing.
   *
   * log2FC ÷ lfcSE is what DESeq2 ranks by, and it is the right default — but
   * lfcSE is optional in the bundle contract, and a bundle that omits it would
   * otherwise open on a metric that can rank nothing and an empty figure with
   * no explanation.
   */
  const hasStat = useMemo(() => canRank(deg, 'stat'), [deg])
  const [metric, setMetric] = useState<RankMetric>(() => (hasStat ? 'stat' : 'combined'))
  useEffect(() => { if (!hasStat && metric === 'stat') setMetric('combined') }, [hasStat, metric])

  const [nperm, setNperm] = useState(1000)
  const [topN, setTopN] = useState(15)
  const [termId, setTermId] = useState('')
  const [run, setRun] = useState<{ busy: boolean; done: number; total: number; err: string | null }>(
    { busy: false, done: 0, total: 0, err: null })
  const [results, setResults] = useState<{ sig: string; rows: GseaResult[] } | null>(null)
  const cancel = useRef(false)

  const ranking = useMemo(() => rankGenes(deg, metric), [deg, metric])
  const sets = useMemo(
    () => (index ? setsFromIndex(index, ranking, minSize, maxSize) : []),
    [index, ranking, minSize, maxSize])

  /**
   * What a result describes, as one string.
   *
   * A GSEA run is not live, so a result can outlive the settings that produced
   * it — change the ranking metric or switch a collection on and the table on
   * screen is answering the previous question under the new question's labels.
   * This app has fixed that same bug twice already elsewhere; here the result
   * carries the signature of its own inputs and is withheld the moment they
   * differ, rather than annotated.
   */
  const sig = `${contrast.id}|${metric}|${nperm}|${minSize}-${maxSize}|${sets.length}|${index?.sets.length ?? 0}|${ranking.genes.length}`
  const fresh = results?.sig === sig ? results.rows : null

  const go = async () => {
    if (!sets.length) return
    cancel.current = false
    setRun({ busy: true, done: 0, total: 1, err: null })
    try {
      const rows = await runGsea(ranking, sets, {
        nperm,
        onProgress: (done, total) => {
          setRun(r => (r.busy ? { ...r, done, total } : r))
          return !cancel.current
        },
      })
      setResults({ sig, rows })
      setRun({ busy: false, done: 0, total: 0, err: null })
    } catch (e: any) {
      setRun({ busy: false, done: 0, total: 0, err: cancel.current ? null : String(e?.message || e) })
    }
  }

  const nSig = fresh ? fresh.filter(r => r.padj < 0.05).length : 0
  useReport(
    () => { if (fresh) reportGsea({
      metric, nperm, minSize, maxSize, nSets: sets.length,
      nRanked: ranking.genes.length, nSig,
      sources: index ? [...index.sources] : [],
    }) },
    fresh ? `${sig}|${nSig}` : '')

  const top = useMemo(() => (fresh ?? []).slice(0, topN), [fresh, topN])
  const selected = (fresh ?? []).find(r => r.id === termId) ?? top[0]
  const selectedSet = selected ? sets.find(s => s.id === selected.id) : undefined

  const curve = useMemo(() => (selectedSet
    ? runningCurve(selectedSet.positions, ranking.weights, ranking.genes.length)
    : null), [selectedSet, ranking])

  const downloadCsv = () => {
    if (!fresh) return
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const header = ['set', 'id', 'source', 'size', 'ES', 'NES', 'pvalue', 'padj',
      'leadingEdgeSize', 'leadingEdge']
    const lines = [header.join(',')]
    for (const r of fresh) {
      lines.push([esc(r.name), r.id, esc(r.source), String(r.size),
        r.es.toFixed(5), r.nes.toFixed(5), r.pvalue.toExponential(4), r.padj.toExponential(4),
        String(r.leadingEdge.length), esc(r.leadingEdge.join(' '))].join(','))
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = `gsea_${contrast.id}_${metric}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const metricInfo = RANK_METRICS.find(m => m.id === metric)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Ctl label="rank genes by">
          <select className="input w-full py-1" value={metric} aria-label="Ranking metric"
            onChange={e => setMetric(e.target.value as RankMetric)}>
            {RANK_METRICS.map(m => (
              <option key={m.id} value={m.id} disabled={m.id === 'stat' && !hasStat}>
                {m.label}{m.id === 'stat' && !hasStat ? ' — no lfcSE in this bundle' : ''}
              </option>
            ))}
          </select>
        </Ctl>
        <Ctl label="permutations">
          <select className="input w-full py-1" value={nperm} aria-label="Permutations per set size"
            onChange={e => setNperm(+e.target.value)}>
            {PERMS.map(p => <option key={p} value={p}>{p.toLocaleString()}{p === 200 ? ' (quick)' : ''}</option>)}
          </select>
        </Ctl>
        <Ctl label="terms shown">
          <input type="number" className="input w-full py-1" value={topN} min={1} max={100}
            aria-label="Terms shown"
            onChange={e => setTopN(Math.max(1, Math.min(100, Math.round(+e.target.value) || 1)))} />
        </Ctl>
        {/* NOT a <Ctl>. A <label> labels a form control, and a <button> is one —
            so wrapping the Run button in one made the label's text part of the
            button's accessible name and left the label pointing at an action
            rather than a field. Screen readers announced it as an unnamed
            control; Playwright could not find it by name at all, which is how
            it was caught. */}
        <div className="flex flex-col justify-end">
          {run.busy ? (
            <div className="flex items-center gap-2">
              <button className="btn w-full justify-center py-1"
                onClick={() => { cancel.current = true }}>Cancel</button>
              <span className="whitespace-nowrap font-mono text-xs text-slate-400">
                {Math.round((run.done / Math.max(run.total, 1)) * 100)}%
              </span>
            </div>
          ) : (
            <button className="btn btn-primary w-full justify-center py-1"
              disabled={!sets.length} onClick={go}>
              {fresh ? 'Re-run GSEA' : 'Run GSEA'}
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-500" title={metricInfo?.blurb}>
        <b>{ranking.genes.length.toLocaleString()}</b> ranked
        {ranking.dropped > 0 && (
          <span className="text-slate-400"
            title={`${ranking.dropped.toLocaleString()} rows had no ${metric === 'stat' ? 'lfcSE' : 'p-value'}, so the metric could not be computed for them.`}>
            {' '}(−{ranking.dropped.toLocaleString()})
          </span>
        )} · <b>{sets.length.toLocaleString()}</b> sets
        {fresh && <> · <b>{nSig.toLocaleString()}</b> at padj &lt; 0.05</>}
      </p>

      {run.err && <p className="text-sm text-red-500">Failed: {run.err}</p>}

      {!fresh && !run.busy && (
        <div className="card p-10 text-center text-sm text-slate-400">
          {!sets.length
            ? `No set has between ${minSize} and ${maxSize} of this contrast's genes. Widen the window, or switch on a collection.`
            // The settings moved under an existing result. Saying so beats
            // showing the old numbers under the new labels.
            : results
              ? 'The ranking or the library changed — those numbers no longer describe this. Run again.'
              : 'Press Run GSEA. It permutes, so it takes a few seconds.'}
        </div>
      )}

      {fresh && (
        <>
          <div className="card p-4">
            <div className="mb-1 flex justify-end">
              <button className="btn py-1 text-xs" onClick={downloadCsv}>⭳ Download CSV</button>
            </div>
            <Plot
              data={[nesTrace(top, contrast)]}
              layout={nesLayout(top.length, contrast)}
              onPointClick={p => p?.customdata && setTermId(p.customdata)}
              downloadName={`GSEA_${contrast.id}_${metric}`}
            />
            <p className="mt-1 text-center text-xs text-slate-400"
              title={`Normalised enrichment score. Positive = the set sits toward the top of the ranking, which for this contrast is ${contrast.numerator}; negative is ${contrast.denominator}. ✱ marks padj < 0.05.`}>
              Click a bar for its running score.
            </p>
          </div>

          <p className="px-1 font-mono text-xs text-slate-400"
            title={'Sets of one size share one null, which is exact rather than binned: under '
              + 'gene-set permutation the null depends on the ranking and the set size and on nothing else.'}>
            {sets.length.toLocaleString()} sets · {nperm.toLocaleString()} permutations · top {top.length}
          </p>

          {selected && curve && (
            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {selected.name}
                  <span className="ml-2 font-mono text-xs normal-case text-slate-400">
                    {selected.id} · {selected.source} · {contrast.label}
                  </span>
                </h3>
                <span className="text-sm text-slate-500">
                  {selected.size} genes · ES {selected.es.toFixed(3)} · NES {selected.nes.toFixed(2)} ·
                  p {fmtP(selected.pvalue)} · padj {fmtP(selected.padj)}
                </span>
              </div>
              <Plot
                data={curveTraces(curve, selectedSet!, ranking.scores, selected)}
                layout={curveLayout(ranking.genes.length, selected, contrast)}
                downloadName={`GSEA_${selected.id}`}
              />
              <LeadingEdge
                genes={selected.leadingEdge} ranking={ranking} up={selected.es >= 0}
                onSelectGene={onSelectGene} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ──────────────────────────────── figures ────────────────────────────────── */

function nesTrace(rows: GseaResult[], contrast: Contrast) {
  const bars = [...rows].reverse()
  return {
    type: 'bar', orientation: 'h',
    x: bars.map(r => r.nes),
    y: bars.map(r => trunc(r.name, 46)),
    customdata: bars.map(r => r.id),
    text: bars.map(r => (r.padj < 0.05 ? '✱' : '')),
    textposition: 'outside',
    marker: {
      color: bars.map(r => (r.nes >= 0 ? SIG_COLORS.up : SIG_COLORS.down)),
      // Faded where it did not survive correction, so a page of nothing looks
      // like a page of nothing rather than a page of coloured bars.
      opacity: bars.map(r => (r.padj < 0.05 ? 0.95 : 0.4)),
    },
    hovertemplate: bars.map(r =>
      `${r.name}<br>NES %{x:.2f} · ES ${r.es.toFixed(3)}<br>`
      + `${r.size} genes · ${r.leadingEdge.length} in the leading edge<br>`
      + `p ${fmtP(r.pvalue)} · padj ${fmtP(r.padj)}<extra></extra>`),
    _contrast: contrast.id,
  }
}

const nesLayout = (n: number, contrast: Contrast) => ({
  title: contrastTitle(`GSEA — ${contrast.label}`),
  height: Math.max(280, 34 * n + 110),
  margin: { t: 46, r: 30, b: 46, l: 300 },
  xaxis: {
    title: `NES   ←  ${contrast.denominator}      ${contrast.numerator}  →`,
    zeroline: true, zerolinecolor: '#94a3b8', zerolinewidth: 1,
  },
  yaxis: { automargin: true, tickfont: { size: 11 } },
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'system-ui, sans-serif' },
  showlegend: false,
})

/**
 * The classic three-panel GSEA figure: the running score, where the members
 * sit, and the ranking metric underneath them.
 *
 * The middle panel is the one that makes it readable — a curve that peaks early
 * is only convincing when you can see the members bunched at the left rather
 * than take the number's word for it.
 */
function curveTraces(
  curve: { x: number[]; y: number[] },
  set: { positions: Int32Array }, scores: Float64Array, r: GseaResult,
) {
  const color = r.es >= 0 ? SIG_COLORS.up : SIG_COLORS.down
  const hits = Array.from(set.positions)
  const n = scores.length
  const step = Math.max(1, Math.floor(n / 1200))
  const mx: number[] = [], my: number[] = []
  for (let i = 0; i < n; i += step) { mx.push(i); my.push(scores[i]) }
  return [
    { type: 'scatter', mode: 'lines', x: curve.x, y: curve.y,
      line: { color, width: 2 }, hovertemplate: 'rank %{x}<br>running ES %{y:.3f}<extra></extra>',
      yaxis: 'y' },
    { type: 'scatter', mode: 'markers', x: hits, y: hits.map(() => 0),
      marker: { symbol: 'line-ns-open', size: 9, color, line: { width: 1.2, color } },
      hovertemplate: 'rank %{x}<extra></extra>', yaxis: 'y2' },
    { type: 'scatter', mode: 'lines', x: mx, y: my, fill: 'tozeroy',
      line: { color: '#94a3b8', width: 0.5 }, fillcolor: 'rgba(148,163,184,0.35)',
      hovertemplate: 'rank %{x}<br>metric %{y:.2f}<extra></extra>', yaxis: 'y3' },
  ]
}

const curveLayout = (n: number, r: GseaResult, contrast: Contrast) => ({
  title: contrastTitle(`${trunc(r.name, 64)} — NES ${r.nes.toFixed(2)}, padj ${fmtP(r.padj)}`),
  height: 420,
  margin: { t: 46, r: 16, b: 46, l: 62 },
  xaxis: {
    title: `gene rank   ←  ${contrast.numerator}                    ${contrast.denominator}  →`,
    range: [0, n - 1], zeroline: false,
  },
  yaxis: { domain: [0.42, 1], title: 'running ES', zeroline: true, zerolinecolor: '#cbd5e1' },
  yaxis2: { domain: [0.3, 0.4], showticklabels: false, showgrid: false, zeroline: false,
    title: { text: 'members', font: { size: 10 } } },
  yaxis3: { domain: [0, 0.26], title: { text: 'metric', font: { size: 10 } }, zeroline: true, zerolinecolor: '#cbd5e1' },
  shapes: [
    { type: 'line', x0: r.peak, x1: r.peak, yref: 'paper', y0: 0.42, y1: 1,
      line: { color: '#94a3b8', width: 1, dash: 'dot' } },
  ],
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'system-ui, sans-serif' },
  showlegend: false,
})

/* ───────────────────────────── the leading edge ──────────────────────────── */

function LeadingEdge({ genes, ranking, up, onSelectGene }: {
  genes: string[]
  ranking: { genes: string[]; labels: string[]; scores: Float64Array; rankOf: Map<string, number> }
  up: boolean
  onSelectGene: (g: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => genes.map(g => {
    const at = ranking.rankOf.get(g.toUpperCase())
    return { g, at, score: at === undefined ? null : ranking.scores[at] }
  }).sort((a, b) => (up ? (a.at ?? 0) - (b.at ?? 0) : (b.at ?? 0) - (a.at ?? 0))), [genes, ranking, up])
  const n = ranking.genes.length

  return (
    <div className="mt-3">
      <button className="text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300"
        onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Leading edge — {genes.length.toLocaleString()} gene{genes.length === 1 ? '' : 's'}
      </button>
      <p className="mt-1 text-xs text-slate-400"
        title={`The members between the ${up ? 'top' : 'bottom'} of the ranking and the peak of the running score — the part of the set that produced it.`}>
        Not a list of significant genes: GSEA thresholded nothing.
      </p>
      {open && (
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2">Gene</th>
                <th className="px-3 py-2 text-right">rank</th>
                <th className="px-3 py-2 text-right">metric</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.g}
                  className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                  onClick={() => onSelectGene(r.g)}>
                  <td className="px-3 py-1.5 font-medium">{r.g}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                    {r.at === undefined ? '—' : `${(r.at + 1).toLocaleString()} / ${n.toLocaleString()}`}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono ${(r.score ?? 0) > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {r.score == null ? '—' : r.score.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}

const trunc = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)
function fmtP(p: number): string {
  if (p == null || Number.isNaN(p)) return '—'
  return p < 1e-3 ? p.toExponential(1) : p.toFixed(3)
}
