import { useMemo, useState } from 'react'
import type { Bundle, Contrast } from '../types'
import { SIG_COLORS, contrastTitle } from '../lib/palette'
import { reportDe, useReport } from '../lib/methods'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

type Cat = 'up' | 'down' | 'ns'

export default function Volcano({ bundle, contrast, onSelectGene }: Props) {
  const rows = bundle.degByContrast[contrast.id] || []
  // Threshold is held in −log10(padj) units so it lines up with the y-axis.
  const [negLogThr, setNegLogThr] = useState(-Math.log10(contrast.padj_threshold ?? 0.05))
  const padjThr = Math.pow(10, -negLogThr)
  const [lfcThr, setLfcThr] = useState(contrast.lfc_threshold ?? 1)

  /**
   * How many genes pass padj but are held back only by the fold-change floor.
   *
   * `lfc_threshold` is a default the exporter stamps on every contrast — the
   * constant 1 — not something measured from the data. On a contrast whose
   * effects are all modest it can exclude the entire result: shrinkage pulls
   * small effects hardest, and the ageing atlas has a hypothalamus comparison with
   * 1,231 genes at padj < 0.05 and not one above |log2FC| = 1. The volcano then
   * opens with every point grey, which reads as "nothing happened here" when
   * what happened is that a default from elsewhere excluded all of it.
   */
  const heldByLfc = useMemo(
    () => rows.filter(r => r.padj != null && r.padj < padjThr
      && Math.abs(r.log2FoldChange) < lfcThr).length,
    [rows, padjThr, lfcThr])
  const nHighlighted = useMemo(
    () => rows.filter(r => r.padj != null && r.padj < padjThr
      && Math.abs(r.log2FoldChange) >= lfcThr).length,
    [rows, padjThr, lfcThr])

  // These are the significance cutoffs a manuscript reports — hand them to the
  // Methods tab so it never has to guess.
  useReport(() => reportDe({ padjThr, lfcThr }), `${padjThr}|${lfcThr}`)

  const cats = useMemo(() => {
    const groups: Record<Cat, { x: number[]; y: number[]; text: string[] }> = {
      up: { x: [], y: [], text: [] },
      down: { x: [], y: [], text: [] },
      ns: { x: [], y: [], text: [] },
    }
    for (const r of rows) {
      if (r.padj == null || Number.isNaN(r.padj) || r.log2FoldChange == null) continue
      const y = -Math.log10(Math.max(r.padj, 1e-300))
      const cat: Cat =
        r.padj < padjThr && r.log2FoldChange >= lfcThr ? 'up'
        : r.padj < padjThr && r.log2FoldChange <= -lfcThr ? 'down'
        : 'ns'
      const g = groups[cat]
      g.x.push(r.log2FoldChange); g.y.push(y)
      g.text.push(r.gene_name || r.gene_id)
    }
    return groups
  }, [rows, padjThr, lfcThr])

  const traces = useMemo(() => {
    const mk = (cat: Cat, name: string) => ({
      type: 'scattergl', mode: 'markers', name,
      x: cats[cat].x, y: cats[cat].y, text: cats[cat].text, customdata: cats[cat].text,
      hovertemplate: '%{text}<br>log2FC %{x:.2f}<br>-log10 padj %{y:.2f}<extra></extra>',
      marker: { color: SIG_COLORS[cat], size: 5, opacity: cat === 'ns' ? 0.35 : 0.8 },
    })
    return [
      mk('ns', 'n.s.'),
      mk('down', `↓ ${contrast.denominator}`),
      mk('up', `↑ ${contrast.numerator}`),
    ]
  }, [cats, contrast])

  const layout = useMemo(() => ({
    title: contrastTitle(`Volcano — ${contrast.label}`),
    margin: { t: 58, r: 10, b: 45, l: 55 },
    xaxis: { title: `log2 fold change  (${contrast.numerator} / ${contrast.denominator})`, zeroline: true },
    yaxis: { title: '−log10 adjusted p-value' },
    legend: { orientation: 'h', y: 1.06, x: 0 },
    shapes: [
      { type: 'line', x0: 0, x1: 0, yref: 'paper', y0: 0, y1: 1, line: { color: '#94a3b8', width: 1, dash: 'dot' } },
      { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: -Math.log10(padjThr), y1: -Math.log10(padjThr), line: { color: '#94a3b8', width: 1, dash: 'dot' } },
    ],
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, sans-serif' },
  }), [contrast, padjThr])

  const nUp = cats.up.x.length, nDown = cats.down.x.length

  return (
    <div className="card p-4">
      {/* Nothing is marked, and the reason is a default rather than the data.
          Said here because the alternative is a grey plot that looks like a
          null result — and the fix is one drag of the slider below. */}
      {nHighlighted === 0 && heldByLfc > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <b>{heldByLfc.toLocaleString()} genes pass padj &lt; {padjThr.toPrecision(2)} but none clear
          |log2FC| ≥ {lfcThr}</b>, so nothing is highlighted. That floor is a default the exporter
          stamps on every comparison, not something measured here — and shrinkage pulls modest
          effects hardest, so a real but small response can be excluded entirely by it. Lower
          |log2FC| below to see the result.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="pill bg-red-100 text-red-700">▲ {nUp} up in {contrast.numerator}</span>
        <span className="pill bg-blue-100 text-blue-700">▼ {nDown} up in {contrast.denominator}</span>
        <label className="ml-auto flex items-center gap-2 text-slate-500">
          −log10 padj ≥
          <input type="range" min={0} max={10} step={0.1} value={Math.min(negLogThr, 10)}
            onChange={e => setNegLogThr(+e.target.value)} />
          <input type="number" className="input w-20 py-0.5" step={0.1} min={0} value={+negLogThr.toFixed(2)}
            onChange={e => setNegLogThr(clamp(+e.target.value, 0, 400))} />
          <span className="font-mono text-xs text-slate-400">padj {padjThr < 1e-3 ? padjThr.toExponential(1) : padjThr.toFixed(3)}</span>
        </label>
        <label className="flex items-center gap-2 text-slate-500">
          |log2FC| ≥
          <input type="range" min={0} max={3} step={0.25} value={lfcThr}
            onChange={e => setLfcThr(+e.target.value)} />
          <span className="w-8 font-mono">{lfcThr.toFixed(2)}</span>
        </label>
      </div>
      <Plot
        data={traces}
        layout={layout}
        style={{ height: 520 }}
        downloadName={`volcano_${contrast.id}`}
        onPointClick={p => p?.customdata && onSelectGene(p.customdata)}
      />
      <p className="mt-2 text-center text-xs text-slate-400">
        Click any point to open that gene in the Expression tab · horizontal line = −log10 padj {negLogThr.toFixed(2)}, vertical = log2FC 0
      </p>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)))
