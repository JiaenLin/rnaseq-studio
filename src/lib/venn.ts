// Where several comparisons agree, and where each one is on its own.
//
// A 2x2 design does not produce one gene list, it produces four — the genotype
// effect at each temperature, the temperature effect in each genotype — and the
// question people actually ask of it is not "which genes are significant" but
// "which of these are the SAME genes". No tab here could answer that: every view
// in the app reads exactly one contrast, so comparing two of them meant
// exporting two CSVs and opening Excel.
//
// This module is the set algebra behind that answer. It is deliberately pure —
// no React, no Plotly, no DOM — because the geometry below has to be TESTED. A
// four-set Venn is only a Venn if all fifteen regions actually exist in the
// drawing, and that is a property of the ellipse parameters, not of the code
// that renders them. `regionAnchors` measures it (scripts/test-venn.mjs), so a
// tweak to a radius that swallows a region fails the build rather than shipping
// a diagram with a silently missing intersection.
//
// TWO GENES CAN BE "THE SAME GENE" IN THREE DIFFERENT WAYS
//
// Membership is keyed on gene_id, never on the symbol. Symbols are not unique,
// are missing from in-browser runs until withSymbols() puts them back, and
// differ in case between pipelines — all three turn one gene into two, or two
// into one, in a diagram whose entire content is counts of shared genes.

import type { DEGRow } from '../types'
import { sideLabel } from './design.ts'

/** Beyond four, a Venn stops being readable and the UpSet matrix takes over. */
export const VENN_MAX = 4
/** Past six the intersection list is longer than anyone reads. */
export const MAX_SETS = 6

export type Direction = 'both' | 'up' | 'down'

export interface Thresholds {
  padjMax: number
  lfcMin: number
  direction: Direction
  /**
   * Keep a gene only when it moves the SAME way in every comparison that calls
   * it significant.
   *
   * Off, an intersection means "significant in both", which on a 2x2 quietly
   * merges the genes a knockout raises in the cold with the ones it lowers in
   * thermoneutrality — the opposite biology, in the same wedge of the diagram.
   * On, that gene is removed and counted in `discordant` instead, so the number
   * is not lost, only kept out of a region that would misdescribe it.
   */
  concordantOnly: boolean
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  padjMax: 0.05, lfcMin: 1, direction: 'both', concordantOnly: false,
}

/** One comparison offered to the diagram, wherever its statistics came from. */
export interface OverlapSource {
  /** Stable identity — a bundle contrast id, or the cache key of a run here. */
  key: string
  label: string
  /** log2FC is signed towards the numerator; the table headers need to say so. */
  numerator: string
  denominator: string
  origin: 'bundle' | 'computed'
  rows: DEGRow[]
}

export interface GeneMembership {
  gene: string
  /** gene_name when any source carries one, else the accession. */
  label: string
  /** Bit i set = significant in sources[i]. */
  mask: number
  /** Per source, the row that made it significant — null where it did not. */
  rows: (DEGRow | null)[]
}

/**
 * One EXCLUSIVE region: genes in exactly these sources and no others.
 *
 * Exclusive rather than inclusive, because that is what a Venn wedge means and
 * what "unique to" and "shared by all" both need. An inclusive count (every gene
 * in A and B, regardless of C) is `regions.filter(...)` away and is never what
 * is drawn.
 */
export interface Region {
  mask: number
  /** Source indices, ascending. */
  members: number[]
  count: number
  genes: GeneMembership[]
}

export interface OverlapResult {
  /** Per source, how many genes survived the thresholds. */
  sizes: number[]
  union: number
  genes: GeneMembership[]
  /** All 2^n − 1 regions, empty ones included — a wedge showing 0 is a result. */
  regions: Region[]
  byMask: Map<number, Region>
  /** Genes dropped for changing in opposite directions. Zero unless asked for. */
  discordant: number
}

/* ────────────────────────────── set building ────────────────────────────── */

/**
 * The significant genes of one comparison, by gene_id.
 *
 * `padj < padjMax` and `|log2FC| >= lfcMin` — the same two comparisons the
 * Volcano tab makes, in the same direction, so a wedge here and a point there
 * never disagree about whether a gene counts.
 */
export function significantGenes(rows: readonly DEGRow[], t: Thresholds): Map<string, DEGRow> {
  const out = new Map<string, DEGRow>()
  for (const r of rows) {
    const p = r.padj, l = r.log2FoldChange
    if (p == null || Number.isNaN(p) || l == null || Number.isNaN(l)) continue
    if (!(p < t.padjMax) || Math.abs(l) < t.lfcMin) continue
    if (t.direction === 'up' && l <= 0) continue
    if (t.direction === 'down' && l >= 0) continue
    // A results table may list a gene twice (multi-mapped ids do happen). Keep
    // the stronger row rather than whichever came last, so the stats shown in
    // the gene table are the ones that put it in the diagram.
    const prev = out.get(r.gene_id)
    if (!prev || (prev.padj ?? 1) > p) out.set(r.gene_id, r)
  }
  return out
}

const popcount = (m: number) => { let c = 0; while (m) { m &= m - 1; c++ } return c }

/** Indices of the set bits, ascending. */
export function maskMembers(mask: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) if (mask & (1 << i)) out.push(i)
  return out
}

const sameDirection = (g: GeneMembership) => {
  let sign = 0
  for (const r of g.rows) {
    if (!r) continue
    const s = Math.sign(r.log2FoldChange)
    if (!sign) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Strongest evidence first: best adjusted p, then largest effect. */
const bestPadj = (g: GeneMembership) =>
  g.rows.reduce((m, r) => (r?.padj != null && r.padj < m ? r.padj : m), Infinity)
const biggestLfc = (g: GeneMembership) =>
  g.rows.reduce((m, r) => (r ? Math.max(m, Math.abs(r.log2FoldChange)) : m), 0)

export function computeOverlap(sources: readonly OverlapSource[], t: Thresholds): OverlapResult {
  const n = sources.length
  const maps = sources.map(s => significantGenes(s.rows, t))
  const byId = new Map<string, GeneMembership>()

  for (let i = 0; i < n; i++) {
    for (const [id, row] of maps[i]) {
      let g = byId.get(id)
      if (!g) {
        g = { gene: id, label: id, mask: 0, rows: new Array(n).fill(null) }
        byId.set(id, g)
      }
      // The first source that knows a symbol names the gene. A run performed
      // here and a table from the pipeline can disagree about that, and the
      // accession is the fallback rather than a blank cell.
      if (g.label === id && row.gene_name && row.gene_name !== id) g.label = row.gene_name
      g.mask |= 1 << i
      g.rows[i] = row
    }
  }

  let discordant = 0
  const genes: GeneMembership[] = []
  for (const g of byId.values()) {
    if (t.concordantOnly && !sameDirection(g)) { discordant++; continue }
    genes.push(g)
  }
  genes.sort((a, b) =>
    popcount(b.mask) - popcount(a.mask)
    || bestPadj(a) - bestPadj(b)
    || biggestLfc(b) - biggestLfc(a)
    || a.label.localeCompare(b.label))

  const byMask = new Map<number, Region>()
  for (let m = 1; m < (1 << n); m++) {
    byMask.set(m, { mask: m, members: maskMembers(m, n), count: 0, genes: [] })
  }
  const sizes = new Array<number>(n).fill(0)
  for (const g of genes) {
    const region = byMask.get(g.mask)!
    region.genes.push(g)
    region.count++
    for (const i of maskMembers(g.mask, n)) sizes[i]++
  }

  // Widest agreement first, then biggest — the reading order of the result.
  const regions = [...byMask.values()].sort((a, b) =>
    popcount(b.mask) - popcount(a.mask) || b.count - a.count || a.mask - b.mask)

  return { sizes, union: genes.length, genes, regions, byMask, discordant }
}

/** How a wedge reads in prose. Regions are exclusive, so every label says so. */
export function regionLabel(members: readonly number[], sources: readonly { label: string }[]): string {
  const names = members.map(i => sources[i]?.label ?? `set ${i + 1}`)
  if (!names.length) return 'nothing'
  if (members.length === sources.length && sources.length > 1)
    return `shared by all ${sources.length}`
  if (names.length === 1) return `only ${names[0]}`
  return `${names.join(' ∩ ')}, and no other`
}

/* ──────────────────────────────── geometry ───────────────────────────────── */

export type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number }

/**
 * Venn outlines in a unit box, in SVG coordinates (y increases downwards).
 *
 * Two and three are circles. Four cannot be drawn with circles at all — no
 * arrangement of four discs produces all fifteen regions — so it is the standard
 * four-ellipse figure, and the ellipse parameters are load-bearing: shift one
 * and a region vanishes without any error. scripts/test-venn.mjs checks that all
 * fifteen are present and large enough to hold their own count.
 */
export const VENN_SHAPES: Record<number, Shape[]> = {
  2: [
    { kind: 'circle', cx: 0.355, cy: 0.5, r: 0.3 },
    { kind: 'circle', cx: 0.645, cy: 0.5, r: 0.3 },
  ],
  3: [
    { kind: 'circle', cx: 0.5, cy: 0.365, r: 0.265 },
    { kind: 'circle', cx: 0.3701, cy: 0.59, r: 0.265 },
    { kind: 'circle', cx: 0.6299, cy: 0.59, r: 0.265 },
  ],
  4: [
    { kind: 'ellipse', cx: 0.375, cy: 0.592, rx: 0.4, ry: 0.19, rot: 34.5 },
    { kind: 'ellipse', cx: 0.47, cy: 0.458, rx: 0.4, ry: 0.19, rot: 41.4 },
    { kind: 'ellipse', cx: 0.53, cy: 0.458, rx: 0.4, ry: 0.19, rot: -41.4 },
    { kind: 'ellipse', cx: 0.625, cy: 0.592, rx: 0.4, ry: 0.19, rot: -34.5 },
  ],
}

const RAD = Math.PI / 180

export function shapeContains(s: Shape, x: number, y: number): boolean {
  const dx = x - s.cx, dy = y - s.cy
  if (s.kind === 'circle') return dx * dx + dy * dy <= s.r * s.r
  // Undo SVG's rotate(rot cx cy), which turns clockwise on screen because y is
  // down — getting this sign wrong mirrors the figure and still looks plausible.
  const c = Math.cos(s.rot * RAD), sn = Math.sin(s.rot * RAD)
  const lx = dx * c + dy * sn
  const ly = -dx * sn + dy * c
  return (lx * lx) / (s.rx * s.rx) + (ly * ly) / (s.ry * s.ry) <= 1
}

/** Which sets cover this point, as a bitmask. */
export function maskAt(shapes: readonly Shape[], x: number, y: number): number {
  let m = 0
  for (let i = 0; i < shapes.length; i++) if (shapeContains(shapes[i], x, y)) m |= 1 << i
  return m
}

export interface Anchor {
  x: number
  y: number
  /** Fraction of the unit box this region covers — a sanity check on the layout. */
  area: number
  /** Distance from the region's edge at the anchor, in unit-box units. */
  depth: number
}

/**
 * Where each region's count can be written, measured rather than hand-placed.
 *
 * The usual approach is a hard-coded table of fifteen label coordinates per
 * layout, which is wrong the moment a radius changes and cannot say whether the
 * layout is a valid Venn at all. This rasterises the figure, labels every cell
 * with the set of shapes covering it, and puts each region's text at the point
 * furthest from that region's boundary — the pole of inaccessibility. Crescents
 * and slivers get a placement inside themselves, which a centroid does not.
 *
 * Also the test: a region absent from the returned map does not exist in the
 * drawing, and `area` says whether it exists only in principle.
 */
export function regionAnchors(shapes: readonly Shape[], res = 181): Map<number, Anchor> {
  const cells = res * res
  const masks = new Int32Array(cells)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) masks[j * res + i] = maskAt(shapes, (i + 0.5) / res, (j + 0.5) / res)
  }

  const INF = 1e9
  const d = new Float64Array(cells)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i, m = masks[k]
      if (m === 0) { d[k] = 0; continue }
      const edge = i === 0 || j === 0 || i === res - 1 || j === res - 1
        || masks[k - 1] !== m || masks[k + 1] !== m || masks[k - res] !== m || masks[k + res] !== m
      d[k] = edge ? 0 : INF
    }
  }

  // Chamfer distance transform, forward then backward. Approximate Euclidean to
  // ~2%, which is far inside what placing a text label needs.
  const A = 1, B = Math.SQRT2
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i
      if (d[k] === 0) continue
      let v = d[k]
      if (i > 0) v = Math.min(v, d[k - 1] + A)
      if (j > 0) v = Math.min(v, d[k - res] + A)
      if (i > 0 && j > 0) v = Math.min(v, d[k - res - 1] + B)
      if (i < res - 1 && j > 0) v = Math.min(v, d[k - res + 1] + B)
      d[k] = v
    }
  }
  for (let j = res - 1; j >= 0; j--) {
    for (let i = res - 1; i >= 0; i--) {
      const k = j * res + i
      if (d[k] === 0) continue
      let v = d[k]
      if (i < res - 1) v = Math.min(v, d[k + 1] + A)
      if (j < res - 1) v = Math.min(v, d[k + res] + A)
      if (i < res - 1 && j < res - 1) v = Math.min(v, d[k + res + 1] + B)
      if (i > 0 && j < res - 1) v = Math.min(v, d[k + res - 1] + B)
      d[k] = v
    }
  }

  const out = new Map<number, Anchor>()
  const area = new Map<number, number>()
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i, m = masks[k]
      if (!m) continue
      area.set(m, (area.get(m) ?? 0) + 1)
      const prev = out.get(m)
      if (!prev || d[k] > prev.depth) {
        out.set(m, { x: (i + 0.5) / res, y: (j + 0.5) / res, area: 0, depth: d[k] })
      }
    }
  }
  for (const [m, a] of out) {
    a.area = (area.get(m) ?? 0) / cells
    a.depth /= res
  }
  return out
}

/* ──────────────────────────────── export ─────────────────────────────────── */

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const cell = (v: number | null | undefined, digits: number) =>
  v == null || Number.isNaN(v) ? '' : v.toPrecision(digits)

/**
 * Every gene in `genes`, with its region and its numbers from each comparison.
 *
 * One row per gene, one pair of columns per comparison — the shape a supplement
 * table wants, and the shape that stays readable when a gene is significant in
 * three of five comparisons. Blank, not zero, where a comparison did not call
 * it: zero is a log2 fold change, and a fold change of zero is a claim.
 */
export function overlapCsv(
  sources: readonly OverlapSource[],
  genes: readonly GeneMembership[],
): string {
  const header = ['gene_id', 'gene_name', 'region', 'n_comparisons']
  for (const s of sources) header.push(`${s.label} log2FC`, `${s.label} padj`)
  const lines = [header.map(esc).join(',')]
  for (const g of genes) {
    const members = maskMembers(g.mask, sources.length)
    const row = [
      g.gene, g.label,
      members.map(i => sources[i].label).join(' ∩ '),
      String(members.length),
    ]
    for (const r of g.rows) row.push(cell(r?.log2FoldChange, 5), cell(r?.padj, 4))
    lines.push(row.map(esc).join(','))
  }
  return lines.join('\n') + '\n'
}

/* ─────────────────────────── the available sets ──────────────────────────── */

/** A DESeq2 run performed in this session, as the reader described it. */
export interface ComputedRun {
  test: string[]
  control: string[]
  /** Only the exclusions that touched THIS pair — see relevantExclusions. */
  excluded: string[]
}

/**
 * Every comparison this session can put in a diagram.
 *
 * Both origins, in one list: the tables the pipeline exported AND the pairs
 * DESeq2 was run for here. Interaction coefficients are included — on a 2x2 the
 * interaction term is often the most interesting circle in the figure, and
 * excluding it because it cannot be tied to samples would be applying a rule
 * about per-sample plots to a diagram that draws no samples.
 */
export function overlapSources(
  contrasts: readonly { id: string; label?: string; numerator: string; denominator: string }[],
  degByContrast: Record<string, DEGRow[]>,
  computed: Record<string, DEGRow[]> = {},
  runs: Record<string, ComputedRun> = {},
): OverlapSource[] {
  const out: OverlapSource[] = []
  for (const c of contrasts) {
    const rows = degByContrast[c.id]
    if (!rows?.length) continue
    out.push({
      key: c.id, label: c.label || c.id,
      numerator: c.numerator, denominator: c.denominator,
      origin: 'bundle', rows,
    })
  }
  for (const [key, rows] of Object.entries(computed)) {
    if (!rows?.length) continue
    const run = runs[key]
    const numerator = run ? sideLabel(run.test) : key
    const denominator = run ? sideLabel(run.control) : ''
    // The exclusions are part of the NAME, not a footnote. Two runs of the same
    // pair with different samples dropped are different results, and a legend
    // that calls them both "KO vs WT" is a figure nobody can interpret.
    const without = run?.excluded.length
      ? ` — without ${run.excluded.length > 2 ? `${run.excluded.length} samples` : run.excluded.join(', ')}`
      : ''
    out.push({
      key: `run:${key}`,
      label: `${denominator ? `${numerator} vs ${denominator}` : numerator}${without}`,
      numerator, denominator, origin: 'computed', rows,
    })
  }
  return out
}

/* ──────────────────── a wedge, as something else can use ──────────────────── */

/** Where a derived set is filed, so re-deriving one replaces it. */
export const OVERLAP_SOURCE = 'From the Overlap tab'

/**
 * The same wedge, said four ways.
 *
 * One function rather than four call sites deciding for themselves, because
 * they had started to: a gene set in the library, a plot title, a filename and
 * a Methods sentence need different lengths AND different grammar, and the
 * first version used the library name everywhere. That put
 * "Shared by all 4: KO vs WT (cold) ∩ KO vs WT (warm) ∩ Cold vs warm (WT) ∩
 * Cold vs warm (KO)" on a bar chart's y-axis, where it wrapped to three lines,
 * and into a sentence as "the 73 genes differentially expressed in shared by
 * all 4 comparisons of 4 comparisons".
 *
 * An empty `members` means the whole figure — every gene significant in at
 * least one comparison. It is a selection people reach for as often as any
 * single wedge, so it is named here rather than special-cased by the caller.
 */
export interface RegionNaming {
  /**
   * Stable id, so saving the same wedge twice REPLACES its set rather than
   * putting one gene list into the multiple-testing correction twice. The hash
   * is over the source keys, so "the first two of these four comparisons" and
   * "the first two of those four" are different sets though both are wedge 3.
   */
  id: string
  /**
   * Self-describing, for the library. Names the comparisons rather than their
   * indices: a set called "1 ∩ 3" means nothing beside HALLMARK_HYPOXIA, and
   * nothing again tomorrow.
   */
  name: string
  /** Short enough for a plot title, a banner and a filename. */
  short: string
  /** A noun phrase completing "The 412 genes ___". */
  prose: string
}

/** Past this a joined list of comparison names stops being a label. */
const SHORT_MAX = 44

export function regionNames(
  members: readonly number[], sources: readonly OverlapSource[],
): RegionNaming {
  const n = sources.length
  const labels = members.map(i => sources[i]?.label ?? '?')
  const all = members.length === n && n > 1
  const any = members.length === 0
  const joined = labels.join(' ∩ ')

  let h = 2166136261
  for (const s of sources) {
    for (let i = 0; i < s.key.length; i++) {
      h ^= s.key.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 47
  }
  const which = members.length ? members.map(i => i + 1).join('-') : 'ANY'

  return {
    id: `OVERLAP_${which}_OF_${n}_${(h >>> 0).toString(36)}`,
    name: any ? `Significant in any of ${n}: ${sources.map(s => s.label).join(' ∪ ')}`
      : all ? `Shared by all ${n}: ${joined}`
        : members.length === 1 ? `Only ${labels[0]}`
          : `${joined} only`,
    short: any ? `Any of ${n} comparisons`
      : all ? `Shared by all ${n}`
        : members.length === 1 ? `Only ${trunc(labels[0], SHORT_MAX - 5)}`
          : joined.length <= SHORT_MAX ? joined
            : `${members.length} of ${n} comparisons`,
    prose: any ? `differentially expressed in at least one of ${n} comparisons`
      : all ? `shared by all ${n} comparisons`
        : members.length === 1
          ? `differentially expressed only in ${labels[0]}`
            // "shared by A and B alone" rather than "...and in none of the other
            // 2 comparisons", which put nine words between the subject and its
            // verb and made the sentence unreadable at exactly the point where
            // it says what was tested.
          : `shared by ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]} alone`,
  }
}

const trunc = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)

/** The gene names a wedge holds, as the rest of the app spells them. */
export const geneNamesOf = (genes: readonly GeneMembership[]): string[] =>
  genes.map(g => g.label || g.gene)

/**
 * Every gene the comparisons in the figure TESTED — the enrichment background.
 *
 * Not the genome and not the union of the wedges. A wedge was drawn from the
 * genes these comparisons could have called significant, so that is the
 * population an over-representation test has to divide by; handing ORA the
 * wedge itself as its own background would make every set it touches look
 * enriched.
 *
 * The union across the chosen comparisons rather than the intersection: the
 * tables of one bundle differ only where independent filtering dropped a gene
 * from one of them, and treating that as "never measured" would shrink N for a
 * reason that has nothing to do with the biology.
 */
export function overlapBackground(sources: readonly OverlapSource[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sources) {
    for (const r of s.rows) {
      const g = r.gene_name || r.gene_id
      if (!seen.has(g)) { seen.add(g); out.push(g) }
    }
  }
  return out
}

/**
 * The strongest row a gene has among the comparisons that put it in the wedge.
 *
 * A wedge is a gene list assembled from several tables, so it has no single
 * log2FC or padj. Rather than pick a comparison arbitrarily, or show nothing,
 * the drill-down carries the best evidence there was — and the interface says
 * that is what it is.
 */
export function bestRows(
  genes: readonly GeneMembership[], sources: readonly OverlapSource[],
): QueryRow[] {
  const out: QueryRow[] = []
  for (const g of genes) {
    let best: DEGRow | null = null
    let at = -1
    for (let i = 0; i < g.rows.length; i++) {
      const r = g.rows[i]
      if (!r) continue
      if (!best || (r.padj ?? 1) < (best.padj ?? 1)) { best = r; at = i }
    }
    if (!best) continue
    const src = sources[at]
    out.push({
      // The label the diagram used, not whichever table won — the two can
      // differ when only one source carries symbols.
      ...best, gene_name: g.label || g.gene,
      from: src?.label ?? '?',
      up: src?.numerator ?? '?',
      down: src?.denominator ?? '?',
    })
  }
  return out
}

/**
 * A DEG row that remembers which comparison it came from.
 *
 * A wedge is assembled from several tables, so the sign of its log2FC points at
 * a different group for different genes. The enrichment drill-down was labelling
 * every one of them with the group names of whatever contrast happened to be
 * selected in the bar at the top of the page — a gene whose evidence came from
 * "Cold vs warm (WT)" was captioned "up in KO_Cold". The row carries its own
 * answer rather than the table guessing.
 */
export interface QueryRow extends DEGRow {
  /** The comparison this row came from. */
  from: string
  /** The group a positive log2FC points towards, in THAT comparison. */
  up: string
  /** And a negative one. */
  down: string
}

/** A wedge handed to the Enrichment tab as its query. */
export interface OverlapQuery {
  /** Short form — the banner, the plot title and the export filenames. */
  label: string
  /** Noun phrase for the Methods sentence. */
  prose: string
  /** How many comparisons it came from. */
  nSets: number
  /**
   * The id this selection has if it was also SAVED as a gene set.
   *
   * Carried so the enrichment can leave that set out of its own test. Testing a
   * gene list against a set that is the same gene list is not a test: it
   * reports a perfect overlap at an astronomical p-value, tops every chart, and
   * pushes real hits down the ranking — observed at ratio 1.000, fold 18.9x,
   * padj 9e-122 the first time somebody saved a wedge and then tested it.
   */
  setId: string
  rows: QueryRow[]
  background: string[]
}

export function overlapQuery(
  sources: readonly OverlapSource[],
  genes: readonly GeneMembership[],
  naming: RegionNaming,
): OverlapQuery {
  return {
    label: naming.short,
    prose: naming.prose,
    nSets: sources.length,
    setId: naming.id,
    rows: bestRows(genes, sources),
    background: overlapBackground(sources),
  }
}
