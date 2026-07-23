import type { GeneSetDef } from '../types'

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
export function hyperTail(k: number, K: number, n: number, N: number): number {
  const maxI = Math.min(K, n)
  const denom = logChoose(N, n)
  let p = 0
  for (let i = k; i <= maxI; i++) p += Math.exp(logChoose(K, i) + logChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(p, 0))
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

  const raw: Omit<ORAResult, 'padj'>[] = []
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
    raw.push({ id: s.id, name: s.name, source: s.source, setSize: K, count: k, overlap, foldEnrichment, pvalue })
  }
  const padj = bh(raw.map(r => r.pvalue))
  return raw.map((r, i) => ({ ...r, padj: padj[i] })).sort((a, b) => a.padj - b.padj)
}
