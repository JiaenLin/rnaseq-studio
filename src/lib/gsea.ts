// Pre-ranked GSEA, beside the over-representation test rather than instead of it.
//
// ORA asks a question about a LIST: you pick a padj and a fold change, the genes
// that clear both become the query, and everything else is discarded. That is
// the right question when the list is what you have, and it has two costs a
// reader feels. The cutoff is arbitrary and the answer moves with it — a term
// significant at padj 0.05 can vanish at 0.01 with no gene having changed. And a
// coordinated shift too small to clear any threshold is invisible: fifty
// members of one pathway each moving 1.3-fold, all in the same direction, is
// exactly the signal a bulk experiment is often built to find, and ORA cannot
// see it because none of the fifty is a DEG.
//
// GSEA asks a question about the RANKING. Every tested gene is ordered by a
// signed statistic, and a set is scored by how far its members sit from where
// they would sit at random. No threshold, nothing discarded, and the answer is
// signed: a set is enriched at the top of the ranking or at the bottom, which
// ORA can only recover by running it twice on two directional lists.
//
// Subramanian et al. 2005, weighted (p = 1) running-sum statistic, with
// significance from GENE-SET permutation — the null a pre-ranked analysis can
// actually build, since sample labels are long gone by the time a bundle exists.
// That is fgsea's null too, and it is worth being explicit that it is not the
// phenotype permutation of the original paper: it tests whether the set's genes
// sit unusually high in THIS ranking, not whether the ranking itself is real.

import type { DEGRow } from '../types'
import type { SetIndex } from './msigdb.ts'
import { bh } from './ora.ts'

/* ─────────────────────────────── the ranking ─────────────────────────────── */

export type RankMetric = 'stat' | 'combined' | 'log2FC' | 'signedP'

export const RANK_METRICS: { id: RankMetric; label: string; blurb: string }[] = [
  { id: 'stat', label: 'Wald statistic (log2FC ÷ lfcSE)',
    blurb: 'What DESeq2 ranks by itself — effect size divided by its own standard error, so a large fold change measured badly does not outrank a smaller one measured well.' },
  { id: 'combined', label: 'Combined score (−log10 p × log2FC)',
    blurb: 'This studio’s own ranking metric, used on the DEG table. Significance and effect size together, signed.' },
  { id: 'signedP', label: 'Signed −log10 p',
    blurb: 'Orders purely by evidence, with the sign of the fold change. Ignores how big the change was.' },
  { id: 'log2FC', label: 'log2 fold change',
    blurb: 'Effect size alone. Puts noisy low-count genes at the extremes, which is why it is not the default.' },
]

export interface Ranking {
  /** UPPER-CASE gene keys, descending by score. */
  genes: string[]
  /** The gene as the bundle spells it, parallel to `genes`. */
  labels: string[]
  scores: Float64Array
  /** |score|^p with p = 1 — the hit weights. */
  weights: Float64Array
  metric: RankMetric
  /** Position of each gene, for mapping a set onto the ranking. */
  rankOf: Map<string, number>
  /** Genes dropped because the metric could not be computed for them. */
  dropped: number
}

const metricOf = (r: DEGRow, m: RankMetric): number | null => {
  const l = r.log2FoldChange
  if (l == null || Number.isNaN(l)) return null
  switch (m) {
    case 'log2FC': return l
    case 'stat': {
      // DESeq2's own `stat`, recovered. Guarded because lfcSE is optional in the
      // bundle contract and a zero would be an infinity in the ranking.
      if (r.lfcSE == null || !(r.lfcSE > 0) || Number.isNaN(r.lfcSE)) return null
      return l / r.lfcSE
    }
    case 'signedP': {
      const p = r.pvalue ?? r.padj
      if (p == null || Number.isNaN(p)) return null
      return Math.sign(l) * (p <= 0 ? 300 : -Math.log10(p))
    }
    case 'combined': {
      const p = r.pvalue ?? r.padj
      if (p == null || Number.isNaN(p)) return null
      return (p <= 0 ? 300 : -Math.log10(p)) * l
    }
  }
}

/** True when this table can be ranked by `stat` — lfcSE is optional in a bundle. */
export const canRank = (rows: readonly DEGRow[], m: RankMetric): boolean =>
  rows.some(r => metricOf(r, m) != null)

/**
 * Every tested gene, ordered by a signed statistic.
 *
 * Ties are broken by gene name rather than left to the sort. Array.prototype.sort
 * is stable, so the order of tied genes would otherwise be the order of the DEG
 * file — which means the same analysis on the same data ranks differently
 * depending on how the exporter happened to sort its rows, and a running-sum
 * statistic reads that difference. GSEA on a table with many tied scores is
 * weak evidence whatever the tie-break, and that is reported rather than hidden.
 */
export function rankGenes(rows: readonly DEGRow[], metric: RankMetric): Ranking {
  const seen = new Set<string>()
  const keep: { key: string; label: string; s: number }[] = []
  let dropped = 0
  for (const r of rows) {
    const s = metricOf(r, metric)
    if (s == null || !Number.isFinite(s)) { dropped++; continue }
    const label = r.gene_name || r.gene_id
    const key = label.toUpperCase()
    // One row per gene. A duplicated symbol would be two positions in the
    // ranking for one gene and would inflate any set that contains it.
    if (seen.has(key)) continue
    seen.add(key)
    keep.push({ key, label, s })
  }
  keep.sort((a, b) => b.s - a.s || a.key.localeCompare(b.key))

  const n = keep.length
  const genes = new Array<string>(n)
  const labels = new Array<string>(n)
  const scores = new Float64Array(n)
  const weights = new Float64Array(n)
  const rankOf = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    genes[i] = keep[i].key
    labels[i] = keep[i].label
    scores[i] = keep[i].s
    weights[i] = Math.abs(keep[i].s)
    rankOf.set(keep[i].key, i)
  }
  return { genes, labels, scores, weights, metric, rankOf, dropped }
}

/* ──────────────────────────── the running statistic ──────────────────────── */

export interface Es {
  es: number
  /** Rank at which the running sum reached its extreme — the leading-edge cut. */
  peak: number
}

/**
 * The weighted Kolmogorov–Smirnov running sum, evaluated only where it turns.
 *
 * Between two hits the running sum only falls, linearly, so its extremes can
 * only occur immediately before a hit (the trough) or at one (the peak). Walking
 * all N ranks would be O(N) per set — 20 000 steps for a 15-gene set — and this
 * is called once per set per permutation, a million times over. O(K).
 *
 * `positions` must be ascending; `nr` is the sum of the hit weights.
 */
export function enrichmentScore(
  positions: ArrayLike<number>, weights: Float64Array, n: number, nr: number,
): Es {
  const k = positions.length
  if (!k || k >= n || !(nr > 0)) return { es: 0, peak: -1 }
  const miss = 1 / (n - k)
  let w = 0, maxD = 0, minD = 0, maxAt = -1, minAt = -1
  for (let j = 0; j < k; j++) {
    const p = positions[j]
    // Just before this hit: j hits and (p − j) misses have been counted.
    const before = w / nr - (p - j) * miss
    if (before < minD) { minD = before; minAt = p }
    w += weights[p]
    const after = w / nr - (p - j) * miss
    if (after > maxD) { maxD = after; maxAt = p }
  }
  return maxD >= -minD ? { es: maxD, peak: maxAt } : { es: minD, peak: minAt }
}

/** The whole curve, for the figure. Sampled, because N is tens of thousands. */
export function runningCurve(
  positions: ArrayLike<number>, weights: Float64Array, n: number, maxPoints = 900,
): { x: number[]; y: number[] } {
  const k = positions.length
  let nr = 0
  for (let j = 0; j < k; j++) nr += weights[positions[j]]
  if (!k || k >= n || !(nr > 0)) return { x: [0, n - 1], y: [0, 0] }
  const miss = 1 / (n - k)
  const hit = new Uint8Array(n)
  for (let j = 0; j < k; j++) hit[positions[j]] = 1
  const step = Math.max(1, Math.floor(n / maxPoints))
  const x: number[] = [], y: number[] = []
  let w = 0, misses = 0
  for (let i = 0; i < n; i++) {
    if (hit[i]) w += weights[i]; else misses++
    // Every hit is kept whatever the sampling: they are where the curve turns,
    // and a sampled-over peak is a figure that disagrees with its own ES.
    if (hit[i] || i % step === 0 || i === n - 1) { x.push(i); y.push(w / nr - misses * miss) }
  }
  return { x, y }
}

/* ──────────────────────────────── the test ───────────────────────────────── */

export interface GseaSet {
  id: string
  name: string
  source: string
  /** Ascending positions in the ranking. */
  positions: Int32Array
}

/**
 * The enabled library, mapped onto the ranking.
 *
 * The index is already folded against the background, and the ranking is built
 * from the same DEG table, so essentially every member maps — but the size
 * window is applied to what ACTUALLY mapped rather than to the set's nominal
 * size, exactly as the ORA path applies it to K.
 */
export function setsFromIndex(
  index: SetIndex, ranking: Ranking, minSize: number, maxSize: number,
): GseaSet[] {
  const out: GseaSet[] = []
  for (const s of index.sets) {
    const pos: number[] = []
    for (const m of s.members) {
      const at = ranking.rankOf.get(index.upper[m])
      if (at !== undefined) pos.push(at)
    }
    if (pos.length < minSize || pos.length > maxSize) continue
    pos.sort((a, b) => a - b)
    out.push({ id: s.id, name: s.name, source: s.source, positions: Int32Array.from(pos) })
  }
  return out
}

export interface GseaResult {
  id: string
  name: string
  source: string
  /** Members that mapped onto the ranking. */
  size: number
  es: number
  nes: number
  pvalue: number
  padj: number
  peak: number
  /** The members driving the score — up to the peak, or down from it. */
  leadingEdge: string[]
}

export interface GseaOptions {
  /** Permutations per SIZE, not per set — see the null below. */
  nperm?: number
  /** Reported as a fraction 0..1; return false to abort. */
  onProgress?: (done: number, total: number) => boolean | void
  seed?: number
}

/** Deterministic, so the same analysis reports the same p-value twice. */
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Null {
  /** Mean of the positive null scores, and of |negative| ones. */
  posMean: number
  negMean: number
  pos: Float64Array
  neg: Float64Array
}

/**
 * The null for one set SIZE, shared by every set of that size.
 *
 * This is what makes the test affordable in a browser. Under gene-set
 * permutation the null distribution of ES depends on the ranking and on K and
 * on nothing else — two different 40-gene sets draw from the same null — so a
 * library of 3 500 sets needs one null per distinct size, a few hundred, rather
 * than 3 500 of them. Exact, not an approximation: no binning across sizes.
 */
function nullFor(k: number, ranking: Ranking, nperm: number, rnd: () => number): Null {
  const n = ranking.genes.length
  const idx = new Int32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  const pick = new Int32Array(k)
  const pos: number[] = [], neg: number[] = []
  for (let t = 0; t < nperm; t++) {
    // Partial Fisher–Yates: k draws without replacement, O(k), and `idx` is
    // left permuted rather than restored — which is harmless, every entry is
    // still present exactly once.
    for (let j = 0; j < k; j++) {
      const r = j + Math.floor(rnd() * (n - j))
      const tmp = idx[j]; idx[j] = idx[r]; idx[r] = tmp
      pick[j] = idx[j]
    }
    pick.sort()
    let nr = 0
    for (let j = 0; j < k; j++) nr += ranking.weights[pick[j]]
    const { es } = enrichmentScore(pick, ranking.weights, n, nr)
    if (es >= 0) pos.push(es); else neg.push(-es)
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  return {
    posMean: mean(pos), negMean: mean(neg),
    pos: Float64Array.from(pos), neg: Float64Array.from(neg),
  }
}

/**
 * Pre-ranked GSEA over an enabled library.
 *
 * Async and chunked: a full library is a few hundred nulls at a thousand
 * permutations each, which is seconds of arithmetic, and doing it synchronously
 * freezes the tab with no way to tell whether it is working or hung. Yields
 * between size classes so the progress bar moves and Cancel is answerable.
 */
export async function runGsea(
  ranking: Ranking, sets: readonly GseaSet[], opts: GseaOptions = {},
): Promise<GseaResult[]> {
  const nperm = opts.nperm ?? 1000
  const n = ranking.genes.length
  const rnd = mulberry32(opts.seed ?? 0x5eed)

  // Grouped by size so each null is built once and used by every set that needs
  // it, and so the work can be reported as a fraction of something real.
  const bySize = new Map<number, GseaSet[]>()
  for (const s of sets) {
    const k = s.positions.length
    const at = bySize.get(k)
    if (at) at.push(s); else bySize.set(k, [s])
  }
  const sizes = [...bySize.keys()].sort((a, b) => a - b)

  const raw: Omit<GseaResult, 'padj'>[] = []
  let done = 0
  for (const k of sizes) {
    const dist = nullFor(k, ranking, nperm, rnd)
    for (const s of bySize.get(k)!) {
      let nr = 0
      for (let j = 0; j < k; j++) nr += ranking.weights[s.positions[j]]
      const { es, peak } = enrichmentScore(s.positions, ranking.weights, n, nr)

      const up = es >= 0
      const arr = up ? dist.pos : dist.neg
      const mean = up ? dist.posMean : dist.negMean
      const mag = Math.abs(es)
      let atLeast = 0
      for (let i = 0; i < arr.length; i++) if (arr[i] >= mag) atLeast++
      // (r + 1)/(m + 1): a permutation p-value can never honestly be zero, and
      // reporting 0 for "none of a thousand draws beat it" would put an
      // infinity in the figure and a false certainty in the table.
      const pvalue = (atLeast + 1) / (arr.length + 1)
      const nes = mean > 0 ? es / mean : 0

      const leadingEdge: string[] = []
      for (let j = 0; j < k; j++) {
        const p = s.positions[j]
        if (up ? p <= peak : p >= peak) leadingEdge.push(ranking.labels[p])
      }
      raw.push({ id: s.id, name: s.name, source: s.source, size: k, es, nes, pvalue, peak, leadingEdge })
    }
    done++
    if (opts.onProgress?.(done, sizes.length) === false) throw new Error('cancelled')
    // One turn of the event loop per size class — enough to repaint, cheap
    // enough not to dominate.
    await new Promise(r => setTimeout(r, 0))
  }

  const padj = bh(raw.map(r => r.pvalue))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i] }))
    .sort((a, b) => Math.abs(b.nes) - Math.abs(a.nes) || a.pvalue - b.pvalue)
}
