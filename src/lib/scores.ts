// Per-sample gene-set activity scores.
//
// mean-z (the "z-score method", Lee 2008) standardizes each gene ACROSS samples,
// so a sample's score depends on the others — unstable with few replicates.
// singscore (Foroutan 2018) ranks genes WITHIN each sample and is therefore a
// stable, single-sample score independent of group composition.

// Ordinal rank (1..N) of every gene within every sample. ranks[i*S + j].
export function computeSampleRanks(values: Float64Array, N: number, S: number): Float32Array {
  const ranks = new Float32Array(N * S)
  const idx = new Array<number>(N)
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < N; i++) idx[i] = i
    idx.sort((a, b) => values[a * S + j] - values[b * S + j])
    for (let r = 0; r < N; r++) ranks[idx[r] * S + j] = r + 1
  }
  return ranks
}

// Undirected singscore per sample for a gene set (rows = gene indices).
// Normalizes the set's mean rank against its theoretical min/max, centered to
// [-0.5, 0.5]; positive = the set sits toward the highly-expressed end.
export function singscore(rows: number[], ranks: Float32Array, N: number, S: number): number[] {
  const m = rows.length
  const out = new Array<number>(S).fill(0)
  if (m === 0) return out
  const minR = (m + 1) / 2
  const range = (N - (m - 1) / 2) - minR || 1
  for (let j = 0; j < S; j++) {
    let sum = 0
    for (const i of rows) sum += ranks[i * S + j]
    out[j] = (sum / m - minR) / range - 0.5
  }
  return out
}
