import { useMemo, useState } from 'react'
import type { Bundle } from '../types'
import type { GroupSel } from '../lib/design'
import { displayOrder } from '../lib/design'
import { conditionColors } from '../lib/palette'
import { pca } from '../lib/pca'
import { reportPca, useReport } from '../lib/methods'
import Plot from '../lib/Plot'

/**
 * Where the samples sit, before any question about a particular gene.
 *
 * This is the first figure anybody draws on a bulk experiment and the app did
 * not have it. It answers the question a DEG table cannot: whether the
 * separation the contrast is about is the largest thing in the data, or whether
 * something else — a batch, a sex, a bad library — is larger.
 *
 * WHICH SAMPLES
 *
 * All of them, by default, and that is deliberate. Every other per-sample view
 * in the app is narrowed to the arms chosen in the comparison bar, because it
 * is asking about those arms. A PCA is asking about the EXPERIMENT, and the
 * commonest reason to draw one is to find structure nobody selected for — an
 * outlier in an arm that is not on screen, a batch that cuts across arms. A PCA
 * that quietly dropped the groups you were not looking at could not answer that
 * and would look exactly like one that could.
 */
export default function PCAPlot({ bundle, sel }: { bundle: Bundle; sel: GroupSel }) {
  const { counts, samples, meta } = bundle

  /** Every annotation column samples.csv carries, beyond the sample name. */
  const covariates = useMemo(() => {
    const keys = new Set<string>()
    for (const s of samples) for (const k of Object.keys(s)) if (k !== 'sample') keys.add(k)
    // `condition` first — it is the one everybody wants — then the rest as
    // written, so a sheet's own column order survives.
    return ['condition', ...[...keys].filter(k => k !== 'condition')]
  }, [samples])

  const [colorBy, setColorBy] = useState('condition')
  const [shapeBy, setShapeBy] = useState('none')
  const [ntop, setNtop] = useState(500)
  const [showLabels, setShowLabels] = useState(true)
  const [pcX, setPcX] = useState(0)
  const [pcY, setPcY] = useState(1)
  const [onlyShown, setOnlyShown] = useState(false)
  const [equalAxes, setEqualAxes] = useState(true)

  const annot = useMemo(() => {
    const m = new Map<string, Record<string, string>>()
    for (const s of samples) m.set(s.sample, s as unknown as Record<string, string>)
    return m
  }, [samples])

  /**
   * The columns to decompose, and their names.
   *
   * Taken from the MATRIX, because that is what has the numbers — a sample
   * listed in samples.csv with no column cannot be plotted, and one in the
   * matrix with no sheet row still can, it just has no annotation to colour by.
   */
  const cols = useMemo(() => {
    const shown = new Set(displayOrder(sel))
    const out: number[] = []
    const names: string[] = []
    counts.samples.forEach((name, j) => {
      if (onlyShown) {
        const cond = annot.get(name)?.condition ?? ''
        if (!shown.has(cond)) return
      }
      out.push(j)
      names.push(name)
    })
    return { cols: out, names }
  }, [counts.samples, annot, sel, onlyShown])

  const result = useMemo(
    () => pca(counts.values, counts.samples.length, cols.cols, cols.names, { ntop }),
    [counts.values, counts.samples.length, cols, ntop])

  // Keep the axes inside what this many samples can actually support.
  const nPC = result.nPC
  const x = Math.min(pcX, Math.max(0, nPC - 1))
  const y = Math.min(pcY, Math.max(0, nPC - 1))

  const valueOf = (name: string, key: string) =>
    key === 'sample' ? name : (annot.get(name)?.[key] ?? '—')

  const colorLevels = useMemo(() => {
    const seen: string[] = []
    for (const n of result.samples) {
      const v = valueOf(n, colorBy)
      if (!seen.includes(v)) seen.push(v)
    }
    // Conditions keep the colour they have everywhere else in the app; any
    // other column gets its own mapping over the same palette.
    return colorBy === 'condition' ? displayOrder(sel).filter(c => seen.includes(c))
      .concat(seen.filter(v => !displayOrder(sel).includes(v))) : seen
  }, [result.samples, colorBy, sel])

  const colors = useMemo(
    () => (colorBy === 'condition' ? conditionColors(meta.conditions) : conditionColors(colorLevels)),
    [colorBy, colorLevels, meta.conditions])

  const shapeLevels = useMemo(() => {
    if (shapeBy === 'none') return []
    const seen: string[] = []
    for (const n of result.samples) {
      const v = valueOf(n, shapeBy)
      if (!seen.includes(v)) seen.push(v)
    }
    return seen
  }, [result.samples, shapeBy])

  useReport(
    () => reportPca({ ntop, nGenes: result.nGenes, nSamples: result.samples.length,
      pcX: x + 1, pcY: y + 1,
      varX: result.varFrac[x] ?? 0, varY: result.varFrac[y] ?? 0 }),
    [ntop, result.nGenes, result.samples.length, x, y,
      result.varFrac[x], result.varFrac[y]].join('|'),
  )

  if (result.nPC < 1) {
    return (
      <div className="card p-8 text-center text-sm text-slate-400">
        {cols.names.length < 2
          ? `A PCA needs at least two samples; this selection has ${cols.names.length}.`
          : 'No gene varies across these samples, so there is nothing to decompose.'}
      </div>
    )
  }

  const traces = colorLevels.map(level => {
    const idx = result.samples
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => valueOf(n, colorBy) === level)
    return {
      type: 'scatter', mode: showLabels ? 'markers+text' : 'markers',
      name: level,
      x: idx.map(({ i }) => result.scores[i][x]),
      y: idx.map(({ i }) => result.scores[i][y]),
      text: idx.map(({ n }) => n),
      textposition: 'top center',
      textfont: { size: 9 },
      hovertext: idx.map(({ n }) => {
        const a = annot.get(n)
        const extra = a ? covariates.map(k => `${k}: ${a[k] ?? '—'}`).join('<br>') : ''
        return `<b>${n}</b><br>${extra}`
      }),
      hovertemplate: `%{hovertext}<br>PC${x + 1} %{x:.2f} · PC${y + 1} %{y:.2f}<extra></extra>`,
      marker: {
        size: 11,
        color: colors[level] ?? '#64748b',
        line: { color: '#334155', width: 1 },
        symbol: shapeBy === 'none' ? 'circle'
          : idx.map(({ n }) => SYMBOLS[shapeLevels.indexOf(valueOf(n, shapeBy)) % SYMBOLS.length]),
      },
    }
  })

  const pct = (k: number) => `${((result.varFrac[k] ?? 0) * 100).toFixed(1)}%`

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2 text-xs">
        <h3 className="mr-auto text-sm font-semibold uppercase tracking-wide text-slate-500">
          Sample PCA
        </h3>
        <Field label="colour by">
          <select className="input py-1" value={colorBy} onChange={e => setColorBy(e.target.value)}>
            {/* The two the question is usually about, then whatever else the
                sheet carries — batch and sex are how a confound shows up. */}
            <option value="condition">group (condition)</option>
            <option value="sample">sample</option>
            {covariates.filter(k => k !== 'condition').map(k =>
              <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="shape by">
          <select className="input py-1" value={shapeBy} onChange={e => setShapeBy(e.target.value)}>
            <option value="none">none</option>
            {covariates.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="x / y">
          <div className="flex items-center gap-1">
            <select className="input py-1" value={x} onChange={e => setPcX(+e.target.value)}>
              {Array.from({ length: nPC }, (_, k) =>
                <option key={k} value={k}>PC{k + 1}</option>)}
            </select>
            <select className="input py-1" value={y} onChange={e => setPcY(+e.target.value)}>
              {Array.from({ length: nPC }, (_, k) =>
                <option key={k} value={k}>PC{k + 1}</option>)}
            </select>
          </div>
        </Field>
        <Field label="top genes">
          <input type="number" className="input w-20 py-1" min={2} step={100} value={ntop}
            onChange={e => setNtop(Math.max(2, Math.round(+e.target.value) || 2))} />
        </Field>
        <label className="flex items-center gap-1.5 text-slate-500">
          <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
          labels
        </label>
        <label className="flex items-center gap-1.5 text-slate-500"
          title="One unit on x is one unit on y, so distances between points are comparable — ggplot's coord_fixed, which DESeq2's plotPCA uses">
          <input type="checkbox" checked={equalAxes} onChange={e => setEqualAxes(e.target.checked)} />
          equal scale
        </label>
        <label className="flex items-center gap-1.5 text-slate-500"
          title="A PCA is normally drawn over the whole experiment — that is how structure in arms you did not select shows up">
          <input type="checkbox" checked={onlyShown} onChange={e => setOnlyShown(e.target.checked)} />
          only shown groups
        </label>
      </div>

      <Plot
        data={traces}
        downloadName={`PCA_PC${x + 1}_PC${y + 1}`}
        layout={{
          margin: { t: 10, r: 10, b: 44, l: 56 }, height: 420,
          xaxis: { title: `PC${x + 1} — ${pct(x)} of variance`, zeroline: true, zerolinecolor: '#e2e8f0' },
          yaxis: {
            title: `PC${y + 1} — ${pct(y)} of variance`, zeroline: true, zerolinecolor: '#e2e8f0',
            // coord_fixed. Without it PC1 at 80% and PC2 at 5% are drawn the
            // same width, which makes a tight cluster look spread out.
            ...(equalAxes ? { scaleanchor: 'x', scaleratio: 1 } : {}),
          },
          legend: { orientation: 'h', y: -0.18, x: 0 },
          hovermode: 'closest',
          paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
          font: { family: 'system-ui, sans-serif' },
        }}
      />

      <p className="mt-1 text-xs text-slate-400">
        {result.samples.length} samples · {result.nGenes.toLocaleString()} most variable genes
        of {result.nVarying.toLocaleString()} that vary · log2(normalized + 1), genes centred,
        not scaled. {nPC} component{nPC === 1 ? '' : 's'} carry anything on{' '}
        {result.samples.length} samples.
        {shapeBy !== 'none' && shapeLevels.length > 0 && (
          <> Shape is <b>{shapeBy}</b>: {shapeLevels.map((l, i) =>
            `${l} ${SYMBOL_NAMES[i % SYMBOLS.length]}`).join(', ')}.</>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        This is DESeq2&rsquo;s <code className="font-mono">plotPCA</code> with one difference: it is
        drawn on log2(normalized + 1) rather than a variance-stabilising transform, because a
        bundle carries normalized counts. Percentages are of the variance in the genes shown.
      </p>
    </div>
  )
}

/** Plotly symbols that stay distinguishable at 11 px, in a deliberate order. */
const SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up', 'cross', 'x', 'star']
const SYMBOL_NAMES = ['●', '■', '◆', '▲', '✚', '✕', '★']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-slate-500">
      <span className="whitespace-nowrap">{label}</span>{children}
    </label>
  )
}
