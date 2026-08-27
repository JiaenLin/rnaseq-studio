import type { GeneSetDef } from '../types'
import type { SetIndex } from './msigdb.ts'

// ── log-gamma (Lanczos) → log-choose → hypergeometric tail ───────────────────
const LG = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
]
function logGamma(x: number): number {
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += LG[j] / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
}

// P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N, K successes total.
/**
 * ln P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N, K successes.
 *
 * The terms are formed in log space — they have to be, since each is a ratio of
 * factorials of tens of thousands — and this sums them there too, rather than
 * exponentiating each one and adding. That is the same discipline `stats.ts`
 * applies to the DE p-values, and it is here for the same reason: a set almost
 * entirely contained in the query has a tail below 1e-308, and adding those
 * terms in linear space returns exactly 0. Not a small number — zero. p = 0
 * makes padj 0, and padj is the sort key, so the strongest results in the table
 * arrive tied at the top in whatever order the library happened to store them.
 *
 * Log-sum-exp, factoring out the largest term so the exponentials that remain
 * are all ≤ 1. The largest is the first: the hypergeometric pmf is decreasing
 * in i past its mode, and the tail is summed from k upward with k at or above
 * the mode whenever the set is enriched — which is the only case that matters
 * here, since this is the one-sided over-representation tail.
 */
export function logHyperTail(k: number, K: number, n: number, N: number): number {
  const maxI = Math.min(K, n)
  if (k > maxI) return -Infinity
  const denom = logChoose(N, n)
  let max = -Infinity
  const terms: number[] = []
  for (let i = k; i <= maxI; i++) {
    const t = logChoose(K, i) + logChoose(N - K, n - i) - denom
    terms.push(t)
    if (t > max) max = t
  }
  if (max === -Infinity) return -Infinity
  let sum = 0
  for (const t of terms) sum += Math.exp(t - max)
  return Math.min(0, max + Math.log(sum))
}

/**
 * P(X ≥ k), as a double.
 *
 * Kept, because a p-value is what a reader expects to see in a column and what
 * a CSV should carry. It underflows to 0 below ~1e-308 and that is fine — what
 * must not happen is for the SORT to underflow with it, which is why `nlp`
 * below is carried alongside and is what the results are ordered on.
 */
export function hyperTail(k: number, K: number, n: number, N: number): number {
  return Math.min(1, Math.max(Math.exp(logHyperTail(k, K, n, N)), 0))
}


// Benjamini–Hochberg adjusted p-values, returned in the input order.
export function bh(ps: number[]): number[] {
  const m = ps.length
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0])
  const adj = new Array(m)
  let prev = 1
  for (let rank = m - 1; rank >= 0; rank--) {
    const [p, idx] = order[rank]
    prev = Math.min(prev, (p * m) / (rank + 1))
    adj[idx] = prev
  }
  return adj
}

/**
 * The same step-up, on −log₁₀ p instead of p.
 *
 * Identical arithmetic seen through a monotone transform: BH multiplies by
 * m/(rank+1), which in −log₁₀ is a subtraction of log₁₀(m/(rank+1)), and its
 * running minimum over p becomes a running maximum over −log₁₀ p. Doing it this
 * way is what lets a set with p = 1e-450 keep a distinct adjusted significance
 * instead of joining every other underflowed set at zero.
 *
 * Input must be ordered by the same key `bh` would order by — which it is, since
 * −log₁₀ p is decreasing in p.
 */
export function bhNlp(nlps: number[]): number[] {
  const m = nlps.length
  // Descending nlp is ascending p, so rank 0 is the smallest p.
  const order = nlps.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])
  const adj = new Array<number>(m)
  let prev = 0
  for (let rank = m - 1; rank >= 0; rank--) {
    const [v, idx] = order[rank]
    prev = Math.max(prev, Math.max(0, v - Math.log10(m / (rank + 1))))
    adj[idx] = prev
  }
  return adj
}

export interface ORAResult {
  id: string
  name: string
  source: string
  setSize: number       // set genes present in the universe (K)
  count: number         // DEGs in the set (k)
  overlap: string[]     // overlapping gene symbols (upper)
  foldEnrichment: number
  pvalue: number
  padj: number
  /**
   * −log₁₀ of the raw p, and after BH of the adjusted p.
   *
   * Carried because `pvalue` and `padj` are doubles and a strongly enriched set
   * against a large background lands below what a double holds. That was
   * survivable while this app shipped five collections inside each bundle; with
   * the whole of MSigDB it is not, because the sets that underflow are exactly
   * the ones a reader is looking for.
   */
  nlp: number
  nlpAdj: number
}

// A gene set with a precomputed upper-cased membership, for fast repeated ORA.
export interface PreparedSet { source: string; id: string; name: string; genes: string[] }

export function prepareSets(defs: GeneSetDef[]): { sets: PreparedSet[]; universe: Set<string> } {
  const universe = new Set<string>()
  const sets = defs.map(d => {
    const genes = d.genes.map(g => g.toUpperCase())
    for (const g of genes) universe.add(g)
    return { source: d.source, id: d.id, name: d.name, genes }
  })
  return { sets, universe }
}

// Over-representation analysis of `degGenes` against `sets`, with the background
// restricted to `universe` (background genes ∩ collection). Real-time friendly.
export function runORA(
  degUpper: Set<string>,
  sets: PreparedSet[],
  background: Set<string>,
  opts: { minSize: number; maxSize: number; sources?: Set<string> },
): ORAResult[] {
  const N = background.size
  let n = 0
  for (const g of degUpper) if (background.has(g)) n++
  if (N === 0 || n === 0) return []

  const raw: Omit<ORAResult, 'padj' | 'nlpAdj'>[] = []
  for (const s of sets) {
    if (opts.sources && !opts.sources.has(s.source)) continue
    let K = 0
    const overlap: string[] = []
    for (const g of s.genes) {
      if (!background.has(g)) continue
      K++
      if (degUpper.has(g)) overlap.push(g)
    }
    if (K < opts.minSize || K > opts.maxSize) continue
    const k = overlap.length
    if (k < 1) continue
    const pvalue = hyperTail(k, K, n, N)
    const foldEnrichment = (k / n) / (K / N)
    raw.push({
      id: s.id, name: s.name, source: s.source, setSize: K, count: k, overlap,
      foldEnrichment, pvalue,
      nlp: Math.max(0, -logHyperTail(k, K, n, N) / Math.LN10),
    })
  }
  // Both, and the order comes from the one that survives underflow: padj stays
  // the number a reader quotes, nlpAdj is the number the table can be sorted by.
  const padj = bh(raw.map(r => r.pvalue))
  const nlpAdj = bhNlp(raw.map(r => r.nlp))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i], nlpAdj: nlpAdj[i] }))
    .sort((a, b) => b.nlpAdj - a.nlpAdj || b.foldEnrichment - a.foldEnrichment)
}

/**
 * The same test, over a library that has already met the background.
 *
 * `runORA` above walks every gene of every set and upper-cases as it goes. That
 * was free across the eighteen hand-written sets this app used to ship; across
 * MSigDB's 20 454 human sets it is about 1.6 million string operations, and it
 * runs again on every drag of a threshold slider.
 *
 * So the part that depends only on the background is hoisted into `indexFor`, and
 * what is left here is a walk over the query: for each query gene, the sets it
 * belongs to. A DEG list touches a fraction of the library, and the sets it
 * never touches cannot have k >= 1 and were never going to be reported.
 *
 * This must agree with `runORA` exactly, not approximately — scripts/test-sets.mjs in scrnaseq-studio
 * asserts they return identical results on the same data, because an
 * optimisation that quietly changes a p-value is a worse bug than a slow page.
 */
export function oraIndexed(
  query: string[],
  index: SetIndex,
  opts: { minSize: number; maxSize: number; sources?: Set<string> } = { minSize: 3, maxSize: 500 },
): ORAResult[] {
  // N is the annotated background — see SetIndex.N and runORA above. n counts
  // the query genes inside it, which is the same rule applied to the same set,
  // so the two describe one population.
  const N = index.N
  if (!N) return []

  const hit: number[] = []
  const inQuery = new Set<number>()
  for (const g of query) {
    const at = index.idOf.get(g.toUpperCase())
    if (at !== undefined && !inQuery.has(at)) { inQuery.add(at); hit.push(at) }
  }
  const n = inQuery.size
  if (!n) return []

  const counts = new Int32Array(index.sets.length)
  for (const at of hit) {
    const sets = index.bySymbol[at]
    for (let i = 0; i < sets.length; i++) counts[sets[i]]++
  }

  const raw: Omit<ORAResult, 'padj' | 'nlpAdj'>[] = []
  for (let i = 0; i < counts.length; i++) {
    const k = counts[i]
    if (k < 1) continue
    const s = index.sets[i]
    if (opts.sources && !opts.sources.has(s.source)) continue
    if (s.K < opts.minSize || s.K > opts.maxSize) continue
    // Only now, and only for a set that will be reported. Walked in member
    // order so the overlap column reads the same way runORA writes it.
    const overlap: string[] = []
    for (let j = 0; j < s.members.length; j++) {
      const at = s.members[j]
      if (inQuery.has(at)) overlap.push(index.symbols[at])
    }
    raw.push({
      id: s.id, name: s.name, source: s.source,
      setSize: s.K, count: k, overlap,
      foldEnrichment: (k / n) / (s.K / N),
      pvalue: hyperTail(k, s.K, n, N),
      nlp: Math.max(0, -logHyperTail(k, s.K, n, N) / Math.LN10),
    })
  }
  // Both, and the order is taken from the one that survives underflow. They are
  // the same step-up on the same ranking, so padj stays the number a reader can
  // quote while nlpAdj is the number the table can be sorted by.
  const padj = bh(raw.map(r => r.pvalue))
  const nlpAdj = bhNlp(raw.map(r => r.nlp))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i], nlpAdj: nlpAdj[i] }))
    .sort((a, b) => b.nlpAdj - a.nlpAdj || b.foldEnrichment - a.foldEnrichment)
}

/**
 * The ends of the enrichment figure's colour scale, from the terms it draws.
 *
 * Two properties, and they pull in opposite directions:
 *
 *   - a page where terms differ must SHOW that they differ, so the domain fits
 *     the terms on screen rather than every term tested. Fitting to the whole
 *     result table put one term at −log₁₀ padj 63 against fifteen below 12 and
 *     rendered four orders of magnitude of real difference as one pale colour.
 *   - a page where nothing is significant must not look significant, so a full
 *     ramp is never stretched across noise. Plotly's own autoscale gives no way
 *     to say this: it fits both ends to the data, so fifteen terms at padj 0.4
 *     come out in the same reds as fifteen at padj 1e-40.
 *
 * The CEILING carries the second one on its own: it never falls below 1.2× the
 * 0.05 line, so a table of terms at padj 0.3 is measured against a scale that
 * reaches past significance and every bar sits low on the ramp. The floor is
 * then free to fit, which is what the first property needs.
 */
export const ORA_CUT = -Math.log10(0.05)

/**
 * ColorBrewer YlOrRd, pale to dark.
 *
 * Written out rather than named, because the stops below have to be placed by
 * hand and Plotly will only interpolate a named scale linearly. These are the
 * same nine colours 'YlOrRd' with `reversescale` was already producing.
 */
const YLORRD = [
  '#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c',
  '#fc4e2a', '#e31a1c', '#bd0026', '#800026',
]

const rampAt = (t: number): string => {
  const x = Math.max(0, Math.min(1, t)) * (YLORRD.length - 1)
  const i = Math.min(YLORRD.length - 2, Math.floor(x))
  const f = x - i
  const [a, b] = [YLORRD[i], YLORRD[i + 1]]
  const mix = (k: number) => Math.round(
    parseInt(a.slice(1 + k * 2, 3 + k * 2), 16) * (1 - f)
    + parseInt(b.slice(1 + k * 2, 3 + k * 2), 16) * f)
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
}

/**
 * Colour stops placed at the drawn terms' OWN values, not spread evenly.
 *
 * A linear ramp between the weakest and strongest term on the figure is what
 * this had, and it is right until the p-values are skewed — which on a real
 * enrichment run they always are. Measured on one: fifteen terms from padj
 * 6e−19 to 1e−115, of which THIRTEEN landed in the bottom 18% of the ramp and
 * came out the same yellow while two outliers owned the rest of it. The figure
 * had a colour axis and used three colours.
 *
 * Equalising fixes it without giving up the meaning. The i-th weakest term gets
 * the i-th colour of the ramp — so every bar is distinguishable and the whole
 * scale is used — while its stop sits at its own value, so colour is still
 * monotonic in p and the colour bar it renders is still a true axis, just a
 * non-linear one. Both properties at once: lowest value palest, highest darkest,
 * and no two bars the same by accident.
 */
export function oraColorScale(nlps: readonly number[]): [number, string][] {
  const v = nlps.filter(Number.isFinite).sort((a, b) => a - b)
  const { lo, hi } = oraColorDomain(nlps)
  const span = hi - lo
  // One term, or all of them identical: nothing to spread, and a zero-width
  // span would put every stop at the same place.
  if (v.length < 2 || span <= 0) return [[0, YLORRD[YLORRD.length - 1]], [1, YLORRD[YLORRD.length - 1]]]

  const stops: [number, string][] = []
  for (let i = 0; i < v.length; i++) {
    const at = Math.max(0, Math.min(1, (v[i] - lo) / span))
    const colour = rampAt(i / (v.length - 1))
    // Plotly needs non-decreasing positions and gains nothing from repeats:
    // two terms with the same p-value are one stop, and it takes the darker.
    if (stops.length && stops[stops.length - 1][0] >= at) stops[stops.length - 1][1] = colour
    else stops.push([at, colour])
  }
  if (stops[0][0] > 0) stops.unshift([0, stops[0][1]])
  if (stops[stops.length - 1][0] < 1) stops.push([1, stops[stops.length - 1][1]])
  return stops
}

export function oraColorDomain(nlps: readonly number[]): { lo: number; hi: number } {
  if (!nlps.length) return { lo: 0, hi: ORA_CUT * 1.2 }
  let lo = Infinity
  let hi = -Infinity
  for (const v of nlps) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: ORA_CUT * 1.2 }
  return { lo, hi: Math.max(ORA_CUT * 1.2, hi) }
}
