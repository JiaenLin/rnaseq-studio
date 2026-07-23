// Per-sample gene-set activity scores.
//
// mean-z (the "z-score method") standardizes each gene ACROSS samples, so a
// sample's score depends on the others — unstable with few replicates.
//
// The weighted rank running-sum below scores each sample INDEPENDENTLY: within a
// sample, genes are ranked by expression and we walk the ranked list computing a
// weighted hit/miss running difference (an ssGSEA-style enrichment score). No
// cross-sample standardization, so it is stable for small 2-group comparisons.

// One descending-by-expression ordering of gene indices per sample. Precompute
// once per bundle; the ordering does not depend on the gene set.
export function computeSortedOrders(values: Float64Array, N: number, S: number): Int32Array[] {
  const orders: Int32Array[] = []
  for (let j = 0; j < S; j++) {
    const idx = Array.from({ length: N }, (_, i) => i)
    idx.sort((a, b) => values[b * S + j] - values[a * S + j]) // highest expression first
    orders.push(Int32Array.from(idx))
  }
  return orders
}

// Weighted rank running-sum enrichment score per sample.
//   position p (0 = highest expression) has weight (N - p)^alpha
//   P_hit(p)  = cumulative set-gene weight / total set weight
//   P_miss(p) = cumulative non-set count / (N - m)
//   ES        = mean over p of (P_hit - P_miss)
// Positive ES → the set's genes sit toward the highly-expressed end in that sample.
export function rankRunningSum(rows: number[], orders: Int32Array[], N: number, alpha = 0.25): number[] {
  const S = orders.length
  const out = new Array<number>(S).fill(0)
  const m = rows.length
  if (m === 0 || m >= N) return out

  const inSet = new Uint8Array(N)
  for (const i of rows) inSet[i] = 1
  const posW = new Float64Array(N)
  for (let p = 0; p < N; p++) posW[p] = Math.pow(N - p, alpha)
  const missDen = N - m

  for (let j = 0; j < S; j++) {
    const ord = orders[j]
    let totalW = 0
    for (let p = 0; p < N; p++) if (inSet[ord[p]]) totalW += posW[p]
    if (totalW === 0) { out[j] = 0; continue }
    let cumHit = 0, cumMiss = 0, es = 0
    for (let p = 0; p < N; p++) {
      if (inSet[ord[p]]) cumHit += posW[p]
      else cumMiss++
      es += cumHit / totalW - cumMiss / missDen
    }
    out[j] = es / N
  }
  return out
}
