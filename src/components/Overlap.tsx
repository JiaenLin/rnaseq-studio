import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Direction, GeneMembership, OverlapQuery, OverlapSource, Region, Thresholds,
} from '../lib/venn'
import {
  DEFAULT_THRESHOLDS, MAX_SETS, OVERLAP_SOURCE, VENN_MAX, VENN_SHAPES,
  computeOverlap, geneNamesOf, overlapCsv, overlapQuery, regionAnchors, regionLabel,
  regionNames,
} from '../lib/venn'
import { collectionOf } from '../lib/msigdb.ts'
import type { LibraryControl } from '../lib/genesets.ts'
import { setColors } from '../lib/palette'
import { reportOverlap, useReport } from '../lib/methods'

interface Props {
  sources: OverlapSource[]
  /** Whether this bundle can run new pairs, for the "get more comparisons" hint. */
  canCompute: boolean
  /** The app's one gene-set library — a saved wedge becomes a collection in it. */
  library: LibraryControl
  /** Hand this wedge to the Enrichment tab as its query, and go there. */
  onEnrich: (q: OverlapQuery) => void
  onSelectGene: (gene: string) => void
}

const MAX_ROWS = 300
/** One frozen empty array, so "the whole figure" is referentially stable. */
const EMPTY_MEMBERS: number[] = []

/**
 * Where several comparisons agree, and where each is on its own.
 *
 * Every other tab in this app reads exactly one contrast. That is the right
 * shape for a volcano and the wrong shape for a factorial design, where the
 * result is not a gene list but the relationship between four of them — which
 * genes respond to the knockout in the cold AND in thermoneutrality, which only
 * in one, and which move in opposite directions in the two. Answering that
 * meant exporting CSVs and opening Excel.
 */
export default function Overlap({ sources, canCompute, library, onEnrich, onSelectGene }: Props) {
  // Up to three by default: enough to be a real intersection, few enough that
  // the first paint is a diagram rather than a puzzle.
  const [picked, setPicked] = useState<string[]>(() => sources.slice(0, 3).map(s => s.key))
  const [thr, setThr] = useState<Thresholds>(DEFAULT_THRESHOLDS)
  const [mask, setMask] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const dark = useDark()

  /**
   * The picker follows the catalogue.
   *
   * Three things can change it while this tab is open, because the comparison
   * bar sits ABOVE the tabs and a DESeq2 run can be started and land without
   * ever leaving this view: a comparison can appear, one can be replaced, and
   * the whole catalogue can be swapped out by opening another bundle. A key
   * that no longer resolves has to go, or the diagram draws fewer circles than
   * the picker shows ticked. And a run that has just landed is the comparison
   * the reader started it for, so it joins the figure rather than waiting to be
   * found in the list.
   */
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const live = new Set(sources.map(s => s.key))
    const fresh = seen.current ? sources.filter(s => !seen.current!.has(s.key)) : []
    seen.current = live
    setPicked(p => {
      const kept = p.filter(k => live.has(k))
      const next = kept.length
        ? [...kept, ...fresh.map(s => s.key).filter(k => !kept.includes(k))].slice(0, MAX_SETS)
        : sources.slice(0, 3).map(s => s.key)
      return next.length === p.length && next.every((k, i) => k === p[i]) ? p : next
    })
  }, [sources])

  const chosen = useMemo(
    () => picked.map(k => sources.find(s => s.key === k)).filter(Boolean) as OverlapSource[],
    [picked, sources])
  const colors = useMemo(() => setColors(chosen.length), [chosen.length])
  const result = useMemo(() => computeOverlap(chosen, thr), [chosen, thr])

  // Whatever region the reader last clicked, unless the set of circles changed
  // under it — a mask means nothing once the sources it indexes are different.
  const n = chosen.length
  const pickedKey = picked.join('|')
  useEffect(() => { setMask(null) }, [pickedKey])
  const selected = mask != null ? result.byMask.get(mask) ?? null : null

  const shared = n > 1 ? (result.byMask.get((1 << n) - 1)?.count ?? 0) : 0
  useReport(
    () => reportOverlap({
      nSets: n, labels: chosen.map(s => s.label),
      padjMax: thr.padjMax, lfcMin: thr.lfcMin,
      direction: thr.direction, concordantOnly: thr.concordantOnly,
      shared, union: result.union,
    }),
    `${n}|${chosen.map(s => s.label).join('~')}|${thr.padjMax}|${thr.lfcMin}|${thr.direction}|${thr.concordantOnly}|${shared}|${result.union}`)

  const toggle = (key: string) => setPicked(p =>
    p.includes(key) ? p.filter(k => k !== key)
      : p.length >= MAX_SETS ? p : [...p, key])

  const shown = useMemo(() => {
    const genes = selected ? selected.genes : result.genes
    const q = filter.trim().toUpperCase()
    return q ? genes.filter(g => g.label.toUpperCase().includes(q) || g.gene.toUpperCase().includes(q)) : genes
  }, [selected, result.genes, filter])

  // Named for the figure, not for its contents: joining six comparison labels
  // produced a 130-character filename that no file dialog could show the end of.
  const stem = chosen.length === 2
    ? `overlap_${slug(chosen[0].label)}_vs_${slug(chosen[1].label)}`
    : `overlap_${chosen.length}_comparisons`
  const saveCsv = (genes: readonly GeneMembership[], suffix: string) =>
    download(overlapCsv(chosen, genes), `${stem}${suffix}.csv`, 'text/csv')

  /**
   * What the two buttons below act on: the selected wedge, or — when none is
   * selected — every gene in the figure.
   *
   * The union is a selection in its own right and the one people reach for
   * most ("everything this experiment moved, anywhere"), so it is not a
   * degenerate case to be disabled; it gets its own name and its own id.
   */
  const targetGenes = selected ? selected.genes : result.genes
  const naming = regionNames(selected ? selected.members : EMPTY_MEMBERS, chosen)
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => { setSaved(null) }, [pickedKey, mask])

  /**
   * The wedge, as a gene set in the library.
   *
   * Merged into ONE collection rather than added as a new one each time, so
   * saving four wedges gives four sets under a single removable heading instead
   * of four headings — and re-saving a wedge replaces its set, because
   * `collectionOf` is last-wins on the id and the id is stable.
   */
  const saveAsSet = () => {
    const genes = geneNamesOf(targetGenes)
    if (!genes.length) return
    const mine = library.customSets.find(c => c.source === OVERLAP_SOURCE)
    const defs = [
      ...(mine ? mine.sets.map(x => ({
        id: x.id, name: x.name, genes: Array.from(x.genes, i => mine.symbols[i]),
      })) : []),
      { id: naming.id, name: naming.name, genes },
    ]
    library.onCustomSets([
      ...library.customSets.filter(c => c.source !== OVERLAP_SOURCE),
      collectionOf(OVERLAP_SOURCE, `${chosen.length} comparisons`, defs),
    ])
    setSaved(naming.name)
  }

  if (!sources.length) {
    return <Empty canCompute={canCompute} what="none" />
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Overlap between comparisons</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Pick the comparisons to intersect — up to {MAX_SETS}. Every wedge is
              <b> exclusive</b>: the genes in exactly those comparisons and no others, so the numbers
              add up to the union rather than double-counting it. Click a number to list its genes.
            </p>
          </div>
          <span className="pill bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {sources.length} available
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {sources.map(s => {
            const i = picked.indexOf(s.key)
            const on = i >= 0
            const full = !on && picked.length >= MAX_SETS
            return (
              <button
                key={s.key}
                aria-pressed={on}
                disabled={full}
                onClick={() => toggle(s.key)}
                title={full
                  ? `Already comparing ${MAX_SETS} — take one out first`
                  : `${s.label} · log2FC is signed towards ${s.numerator}`}
                className={`pressable flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${on
                  ? 'border-slate-400 bg-white font-medium text-slate-800 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100'
                  : full
                    ? 'border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700'}`}
              >
                <span className="h-2.5 w-2.5 rounded-full"
                  style={{ background: on ? colors[i] : 'transparent', border: on ? 'none' : '1px solid #cbd5e1' }} />
                {s.label}
                {on && <span className="font-mono opacity-60">{result.sizes[i].toLocaleString()}</span>}
                {s.origin === 'computed' &&
                  <span className="rounded bg-indigo-100 px-1 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">run here</span>}
              </button>
            )
          })}
        </div>

        <Controls thr={thr} onThr={setThr} discordant={result.discordant} />
      </div>

      {n < 2 ? (
        <Empty canCompute={canCompute} what={sources.length < 2 ? 'one-source' : 'one-picked'} />
      ) : (
        <>
          <div className="card p-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 flex-1">
                {n <= VENN_MAX
                  ? <VennFigure ref={svgRef} sources={chosen} colors={colors} result={result}
                    selected={mask} onPick={setMask} dark={dark} />
                  : <UpsetFigure ref={svgRef} sources={chosen} colors={colors} result={result}
                    selected={mask} onPick={setMask} dark={dark} />}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <button className="btn py-1 text-xs" onClick={() => svgRef.current && svgToPng(svgRef.current, stem)}>⭳ PNG</button>
                  <button className="btn py-1 text-xs" onClick={() => svgRef.current && svgToSvg(svgRef.current, stem)}>⭳ SVG</button>
                </div>
              </div>

              <RegionList sources={chosen} colors={colors} regions={result.regions}
                selected={mask} onPick={setMask} union={result.union} />
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  {selected
                    ? cap(regionLabel(selected.members, chosen))
                    : 'Every gene significant in at least one comparison'}
                </h3>
                <p className="text-xs text-slate-400">
                  {(selected ? selected.count : result.union).toLocaleString()} gene
                  {(selected ? selected.count : result.union) === 1 ? '' : 's'}
                  {selected && ' · and in none of the others'}
                </p>
              </div>
              <input className="input ml-auto w-44 py-1" placeholder="Filter genes…"
                value={filter} onChange={e => setFilter(e.target.value)} />
              {selected && <button className="btn py-1 text-xs" onClick={() => setMask(null)}>Show all</button>}
              {/* The two things a gene list is FOR. Enrichment tests it against
                  the library; saving makes it a set the rest of the app can
                  score per sample and test like any other. */}
              <button className="btn btn-primary py-1 text-xs" disabled={!targetGenes.length}
                title={`Run over-representation analysis on these ${targetGenes.length} genes`}
                onClick={() => onEnrich(overlapQuery(chosen, targetGenes, naming))}>
                ⌕ Test for enrichment
              </button>
              <button className="btn py-1 text-xs" disabled={!targetGenes.length}
                title="Add these genes to the gene-set library as a named set"
                onClick={saveAsSet}>
                ＋ Save as gene set
              </button>
              <button className="btn py-1 text-xs"
                onClick={() => saveCsv(shown, selected ? `_${slug(regionLabel(selected.members, chosen))}` : '_all')}>
                ⭳ CSV
              </button>
            </div>
            {saved && (
              <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <b>“{saved}”</b> added to the gene-set library under “{OVERLAP_SOURCE}”. Score it per
                sample on <b>Gene sets</b>, or edit and remove it under <b>Collections</b>.
                {' '}Testing this same selection leaves it out of its own test.
              </p>
            )}
            <GeneTable sources={chosen} colors={colors} genes={shown} onSelectGene={onSelectGene} />
          </div>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────── controls ────────────────────────────────── */

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'both', label: 'Either' },
  { id: 'up', label: 'Up only' },
  { id: 'down', label: 'Down only' },
]

function Controls({ thr, onThr, discordant }: {
  thr: Thresholds; onThr: (t: Thresholds) => void; discordant: number
}) {
  const set = (patch: Partial<Thresholds>) => onThr({ ...thr, ...patch })
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
      <label className="flex items-center gap-2 text-slate-500">
        padj &lt;
        <input type="number" className="input w-24 py-0.5" step={0.01} min={0} max={1} value={thr.padjMax}
          onChange={e => set({ padjMax: clamp(+e.target.value, 1e-300, 1) })} />
      </label>
      <label className="flex items-center gap-2 text-slate-500">
        |log2FC| ≥
        <input type="range" min={0} max={3} step={0.25} value={thr.lfcMin}
          onChange={e => set({ lfcMin: +e.target.value })} />
        <span className="w-8 font-mono">{thr.lfcMin.toFixed(2)}</span>
      </label>
      <label className="flex items-center gap-2 text-slate-500">
        direction
        <select className="input w-28 py-0.5" value={thr.direction}
          onChange={e => set({ direction: e.target.value as Direction })}>
          {DIRECTIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-slate-500"
        title="Without this, a gene up in one comparison and down in another still lands in their intersection.">
        <input type="checkbox" checked={thr.concordantOnly}
          onChange={e => set({ concordantOnly: e.target.checked })} />
        same direction only
      </label>
      {thr.concordantOnly && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {discordant.toLocaleString()} gene{discordant === 1 ? '' : 's'} set aside for moving opposite ways
        </span>
      )}
    </div>
  )
}

/* ──────────────────────────────── the Venn ───────────────────────────────── */

const PAD = 10
const BOX = 480
const HEAD = 8
const LEG_ROW = 21

interface FigProps {
  ref: React.Ref<SVGSVGElement>
  sources: OverlapSource[]
  colors: string[]
  result: ReturnType<typeof computeOverlap>
  selected: number | null
  onPick: (mask: number | null) => void
  dark: boolean
}

function VennFigure({ ref, sources, colors, result, selected, onPick, dark }: FigProps) {
  const n = sources.length
  const shapes = VENN_SHAPES[n] ?? []
  // Only the layout decides this, so it is computed once per set count rather
  // than on every threshold change — it is a 181x181 rasterisation.
  const anchors = useMemo(() => regionAnchors(shapes), [n]) // eslint-disable-line react-hooks/exhaustive-deps
  const ink = dark ? '#e2e8f0' : '#0f172a'
  const height = HEAD + BOX + 10 + n * LEG_ROW + PAD

  return (
    <svg ref={ref} viewBox={`0 0 ${BOX + PAD * 2} ${height}`} role="img"
      aria-label={`Venn diagram of ${n} comparisons`}
      style={{ width: '100%', maxHeight: 620 }}>
      <rect width="100%" height="100%" fill="none" />
      <g transform={`translate(${PAD} ${HEAD})`}>
        {shapes.map((s, i) => (s.kind === 'circle' ? (
          <circle key={i} cx={s.cx * BOX} cy={s.cy * BOX} r={s.r * BOX}
            fill={colors[i]} fillOpacity={0.22} stroke={colors[i]} strokeWidth={2} />
        ) : (
          <ellipse key={i} cx={s.cx * BOX} cy={s.cy * BOX} rx={s.rx * BOX} ry={s.ry * BOX}
            transform={`rotate(${s.rot} ${s.cx * BOX} ${s.cy * BOX})`}
            fill={colors[i]} fillOpacity={0.22} stroke={colors[i]} strokeWidth={2} />
        )))}

        {result.regions.map(r => {
          const a = anchors.get(r.mask)
          if (!a) return null
          const x = a.x * BOX, y = a.y * BOX
          const text = r.count.toLocaleString()
          const w = Math.max(24, text.length * 9 + 12)
          const on = selected === r.mask
          return (
            <g key={r.mask} style={{ cursor: 'pointer' }}
              onClick={() => onPick(on ? null : r.mask)}>
              <title>{`${regionLabel(r.members, sources)} — ${text} genes`}</title>
              <rect x={x - w / 2} y={y - 11} width={w} height={22} rx={11}
                fill={on ? ink : '#ffffff'} fillOpacity={on ? 1 : 0.001} />
              <text x={x} y={y + 5} textAnchor="middle" fontSize={15}
                fontFamily="system-ui, sans-serif"
                fontWeight={r.members.length === n && n > 1 ? 700 : 500}
                fill={on ? (dark ? '#0f172a' : '#ffffff') : ink}
                {...(on ? {} : { 'data-ink': '1' })}>
                {text}
              </text>
            </g>
          )
        })}
      </g>
      <Legend sources={sources} colors={colors} sizes={result.sizes} ink={ink}
        y={HEAD + BOX + 10} />
    </svg>
  )
}

function Legend({ sources, colors, sizes, ink, y }: {
  sources: OverlapSource[]; colors: string[]; sizes: number[]; ink: string; y: number
}) {
  return (
    <g transform={`translate(${PAD} ${y})`} fontFamily="system-ui, sans-serif">
      {sources.map((s, i) => (
        <g key={s.key} transform={`translate(0 ${i * LEG_ROW})`}>
          <rect x={0} y={2} width={12} height={12} rx={3}
            fill={colors[i]} fillOpacity={0.35} stroke={colors[i]} strokeWidth={1.5} />
          {/* dx, not spaces: SVG collapses leading whitespace inside a tspan,
              so the legend ran together as "n = 583↑ = higher in KO_Cold". */}
          <text x={19} y={12} fontSize={12.5} fill={ink} data-ink="1">
            {s.label}
            <tspan dx={9} fillOpacity={0.6}>{`n = ${sizes[i].toLocaleString()}`}</tspan>
            <tspan dx={9} fillOpacity={0.45}>{`·`}</tspan>
            <tspan dx={9} fillOpacity={0.45}>{`↑ = higher in ${s.numerator}`}</tspan>
          </text>
        </g>
      ))}
    </g>
  )
}

/* ─────────────────── beyond four circles: the UpSet matrix ───────────────── */

const UP_COL = 26
const UP_BARS = 150
const UP_ROW = 22
const UP_LEFT = 190
const UP_MAX = 22
/** Below the caption — the tallest bar's own label used to sit on top of it. */
const UP_TOP = 44

function UpsetFigure({ ref, sources, colors, result, selected, onPick, dark }: FigProps) {
  const n = sources.length
  const cols = result.regions.filter(r => r.count > 0).slice(0, UP_MAX)
  const dropped = result.regions.filter(r => r.count > 0).length - cols.length
  const top = Math.max(1, ...cols.map(c => c.count))
  const ink = dark ? '#e2e8f0' : '#0f172a'
  const grid = dark ? '#334155' : '#e2e8f0'
  const width = UP_LEFT + Math.max(cols.length, 1) * UP_COL + PAD
  const height = UP_TOP + UP_BARS + 8 + n * UP_ROW + 26

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Intersection sizes across ${n} comparisons`}
      style={{ width: '100%', maxHeight: 620 }} fontFamily="system-ui, sans-serif">
      <text x={PAD} y={16} fontSize={12.5} fill={ink} data-ink="1" fillOpacity={0.7}>
        Exclusive intersections, largest first{dropped > 0 ? ` — ${dropped} smaller not shown` : ''}
      </text>
      {cols.map((r, j) => {
        const x = UP_LEFT + j * UP_COL
        const h = (r.count / top) * UP_BARS
        const on = selected === r.mask
        return (
          <g key={r.mask} style={{ cursor: 'pointer' }} onClick={() => onPick(on ? null : r.mask)}>
            <title>{`${regionLabel(r.members, sources)} — ${r.count.toLocaleString()} genes`}</title>
            <rect x={x} y={UP_TOP} width={UP_COL} height={UP_BARS + 8 + n * UP_ROW}
              fill={on ? ink : '#ffffff'} fillOpacity={on ? 0.08 : 0.001} />
            <rect x={x + 4} y={UP_TOP + UP_BARS - h} width={UP_COL - 8} height={Math.max(h, 1)} rx={2}
              fill={on ? ink : '#64748b'} />
            <text x={x + UP_COL / 2} y={UP_TOP + UP_BARS - h - 4} textAnchor="middle" fontSize={10}
              fill={ink} data-ink="1" fillOpacity={0.75}>{r.count.toLocaleString()}</text>
            {Array.from({ length: n }, (_, i) => {
              const inSet = (r.mask & (1 << i)) !== 0
              return <circle key={i} cx={x + UP_COL / 2} cy={UP_TOP + UP_BARS + 8 + i * UP_ROW + UP_ROW / 2} r={5}
                fill={inSet ? colors[i] : grid} />
            })}
            {r.members.length > 1 && (
              <line x1={x + UP_COL / 2} x2={x + UP_COL / 2}
                y1={UP_TOP + UP_BARS + 8 + r.members[0] * UP_ROW + UP_ROW / 2}
                y2={UP_TOP + UP_BARS + 8 + r.members[r.members.length - 1] * UP_ROW + UP_ROW / 2}
                stroke={ink} strokeOpacity={0.45} strokeWidth={2} />
            )}
          </g>
        )
      })}
      {sources.map((s, i) => (
        <text key={s.key} x={UP_LEFT - 8} y={UP_TOP + UP_BARS + 8 + i * UP_ROW + UP_ROW / 2 + 4}
          textAnchor="end" fontSize={12} fill={ink} data-ink="1">
          {trunc(s.label, 26)}
          <tspan dx={8} fillOpacity={0.55}>{result.sizes[i].toLocaleString()}</tspan>
        </text>
      ))}
    </svg>
  )
}

/* ────────────────────────────── region list ──────────────────────────────── */

function RegionList({ sources, colors, regions, selected, onPick, union }: {
  sources: OverlapSource[]; colors: string[]; regions: Region[]
  selected: number | null; onPick: (m: number | null) => void; union: number
}) {
  const n = sources.length
  /**
   * The list mirrors the figure beside it.
   *
   * Under a Venn that is widest-agreement first, the reading order of the
   * diagram. Under an UpSet it is largest first, the order of the bars. Six sets
   * have sixty-three regions and almost all of them are empty, so leaving the
   * Venn's order in place there buried every real number under two screens of
   * zeros — and the empty ones are then dropped entirely rather than scrolled
   * past, with a line saying how many there were.
   */
  const rows = useMemo(() => {
    const ordered = n > VENN_MAX ? [...regions].sort((a, b) => b.count - a.count) : regions
    return regions.length > 20 ? ordered.filter(r => r.count > 0) : ordered
  }, [regions, n])
  const hidden = regions.length - rows.length

  return (
    <div className="w-full shrink-0 lg:w-72">
      <div className="mb-1.5 flex items-baseline justify-between text-xs uppercase tracking-wide text-slate-500">
        <span>Regions</span>
        <span className="normal-case tracking-normal text-slate-400">{union.toLocaleString()} in total</span>
      </div>
      <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full text-xs">
          <tbody>
            {rows.map(r => {
              const on = selected === r.mask
              const all = r.members.length === n && n > 1
              return (
                <tr key={r.mask}
                  className={`cursor-pointer border-t border-slate-100 first:border-t-0 dark:border-slate-800 ${on
                    ? 'bg-indigo-50 dark:bg-indigo-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  onClick={() => onPick(on ? null : r.mask)}>
                  <td className="py-1.5 pl-2">
                    <span className="flex items-center gap-1">
                      {Array.from({ length: n }, (_, i) => (
                        <span key={i} className="h-2 w-2 rounded-full"
                          style={{ background: (r.mask & (1 << i)) ? colors[i] : 'transparent',
                            border: (r.mask & (1 << i)) ? 'none' : '1px solid currentColor', opacity: (r.mask & (1 << i)) ? 1 : 0.2 }} />
                      ))}
                    </span>
                  </td>
                  <td className={`py-1.5 pl-2 ${all ? 'font-semibold' : ''} ${r.count ? '' : 'text-slate-400'}`}>
                    {r.members.length === 1
                      ? `only ${trunc(sources[r.members[0]].label, 22)}`
                      : all ? `all ${n}` : r.members.map(i => i + 1).join(' ∩ ')}
                  </td>
                  <td className={`py-1.5 pr-2 text-right font-mono ${r.count ? '' : 'text-slate-400'}`}>
                    {r.count.toLocaleString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
        Numbers are the comparisons in legend order, and every row is exclusive — “1 ∩ 2” means those
        two and none of the rest, so the counts sum to the total.
        {hidden > 0 && ` ${hidden.toLocaleString()} more combinations hold no genes.`}
      </p>
    </div>
  )
}

/* ─────────────────────────────── gene table ──────────────────────────────── */

function GeneTable({ sources, colors, genes, onSelectGene }: {
  sources: OverlapSource[]; colors: string[]; genes: readonly GeneMembership[]
  onSelectGene: (g: string) => void
}) {
  if (!genes.length) {
    return <p className="py-8 text-center text-sm text-slate-400">No genes here at these cutoffs.</p>
  }
  return (
    <>
      <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">Gene</th>
              {sources.map((s, i) => (
                <th key={s.key} className="px-3 py-2 text-right font-medium normal-case tracking-normal"
                  title={`log2FC and padj — signed towards ${s.numerator}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: colors[i] }} />
                    {trunc(s.label, 18)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {genes.slice(0, MAX_ROWS).map(g => (
              <tr key={g.gene}
                className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                onClick={() => onSelectGene(g.label || g.gene)}>
                <td className="px-3 py-1.5 font-medium">
                  {g.label}
                  {g.label !== g.gene &&
                    <span className="ml-1.5 font-mono text-xs text-slate-400">{g.gene}</span>}
                </td>
                {g.rows.map((r, i) => (
                  <td key={i} className="px-3 py-1.5 text-right">
                    {r ? (
                      <>
                        <span className={`font-mono ${r.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {r.log2FoldChange > 0 ? '+' : ''}{r.log2FoldChange.toFixed(2)}
                        </span>
                        <span className="ml-1.5 font-mono text-[11px] text-slate-400">{fmtP(r.padj)}</span>
                      </>
                    ) : <span className="text-slate-300 dark:text-slate-600">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {genes.length > MAX_ROWS && (
        <p className="mt-2 text-center text-xs text-slate-400">
          Showing the {MAX_ROWS} strongest of {genes.length.toLocaleString()} — download the CSV for all of them.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Each column is one comparison: log2 fold change, then its adjusted p-value. A dot means that
        comparison did not call the gene significant at these cutoffs — not that it measured no change.
        Click any row to open the gene on the Gene expression tab.
      </p>
    </>
  )
}

/* ──────────────────────────────── empties ────────────────────────────────── */

function Empty({ canCompute, what }: { canCompute: boolean; what: 'none' | 'one-source' | 'one-picked' }) {
  return (
    <div className="card mx-auto mt-6 max-w-xl p-8 text-center">
      <h3 className="text-base font-semibold">
        {what === 'one-picked' ? 'Pick at least two comparisons' : 'An overlap needs two comparisons'}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        {what === 'one-picked' ? (
          'Tick another one above and the diagram appears.'
        ) : (
          <>
            This bundle carries {what === 'none' ? 'no' : 'one'} differential-expression table, and a Venn
            diagram of one set is a circle.{' '}
            {canCompute
              ? 'Choose another pair of groups in the bar at the top of the page and run DESeq2 for it — every run this session is offered here.'
              : 'Export the other contrasts from your pipeline, or re-export the bundle with raw_counts.csv so pairs can be tested here.'}
          </>
        )}
      </p>
    </div>
  )
}

/* ──────────────────────────────── helpers ───────────────────────────────── */

/**
 * The figure is SVG, not Plotly, so the app's usual PNG button does not apply.
 *
 * Serialised, drawn onto a canvas, and always exported on WHITE with dark text
 * whatever the screen is showing — a figure leaves this app to go into a
 * manuscript, and the manuscript is not in dark mode.
 */
function svgToPng(svg: SVGSVGElement, name: string, scale = 2) {
  const { xml, w, h } = serialize(svg)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = Math.round(w * scale); c.height = Math.round(h * scale)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    c.toBlob(b => { if (b) save(b, `${name}.png`) })
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
}

/** The same figure as vector, which is what a journal actually asks for. */
function svgToSvg(svg: SVGSVGElement, name: string) {
  const { xml } = serialize(svg)
  save(new Blob([xml], { type: 'image/svg+xml' }), `${name}.svg`)
}

function serialize(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // Text carries the screen's ink colour as an attribute; on export it becomes
  // the page's, or a dark-mode figure lands as white-on-white.
  clone.querySelectorAll('[data-ink]').forEach(el => el.setAttribute('fill', '#0f172a'))
  const vb = svg.viewBox.baseVal
  const w = vb?.width || svg.clientWidth || 520
  const h = vb?.height || svg.clientHeight || 560
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  return { xml: new XMLSerializer().serializeToString(clone), w, h }
}

function save(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const download = (text: string, filename: string, type: string) =>
  save(new Blob([text], { type }), filename)

/** The figure's ink has to be a real attribute for export, so the theme is read. */
function useDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const trunc = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)
const slug = (s: string) => s.replace(/[^\w+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'set'
function fmtP(p: number | null): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(1) : p.toFixed(3)
}
