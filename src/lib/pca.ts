// Principal components of a bulk RNA-seq count matrix.
//
// This is DESeq2's `plotPCA`, and it is written to be that rather than to be a
// PCA: log the counts, keep the most variable genes, centre each gene, and take
// the principal components of the SAMPLES. Every step below has a default that
// matters to whether two figures of the same experiment agree, so each one is
// stated here rather than left to whatever a linear-algebra helper happens to
// do —
//
//   ntop = 500      the genes entering the decomposition, by variance. DESeq2's
//                   default. It is not a detail: PC1 of the whole
//                   transcriptome is usually library composition, and PC1 of
//                   the 500 most variable genes is usually the experiment.
//   centre, no scale  prcomp(center = TRUE, scale. = FALSE), which is what
//                   plotPCA calls. Scaling would give a gene varying between 3
//                   and 4 the same say as one varying between 3 and 300.
//   percentVar      each eigenvalue over the sum of ALL of them, so the
//                   printed percentages are of the total variance in those 500
//                   genes and add to 100 across every component.
//
// The one thing that CANNOT match DESeq2 is the transform. plotPCA is called on
// a variance-stabilised object (vst or rlog), and a bundle carries normalised
// counts, so this takes log2(x + 1) — the same monotone squashing of the
// mean-variance relationship, less carefully done. Said out loud on the card
// and in the Methods text, because "PCA" with no transform named is not a
// reproducible sentence.
//
// The decomposition itself is exact, not iterative-approximate: a bulk
// experiment has tens of samples, so the sample-space Gram matrix is at most a
// few hundred square and a Jacobi sweep diagonalises it to machine precision in
// microseconds. There is no reason to reach for a randomised solver at this
// size, and every reason not to — a PCA that moves slightly between renders is
// a figure nobody can put in a paper.

export interface PCAResult {
  /** Sample names, in the order the score rows are in. */
  samples: string[]
  /** scores[i][k] — sample i on PC k+1, in the units of the logged data. */
  scores: number[][]
  /** Fraction of total variance carried by each PC. Sums to 1. */
  varFrac: number[]
  /**
   * Components that carry anything.
   *
   * Centring the genes makes every column of the sample matrix sum to zero, so
   * the rank is at most S − 1 and the last component is numerically zero. A UI
   * that offers "PC8" on eight samples is offering an axis of rounding error.
   */
  nPC: number
  /** Genes that entered the decomposition, after the variance filter. */
  nGenes: number
  /** Genes that varied at all across these samples — what `nGenes` was taken from. */
  nVarying: number
}

/**
 * Jacobi eigenvalue iteration for a real symmetric matrix.
 *
 * Returns eigenvalues and the matching eigenvectors as COLUMNS of `vectors`,
 * unsorted. Rotations are applied as VᵀAV with V holding c and s at (p,p),
 * (p,q), (q,p) = −s and (q,q), which is the convention the angle below solves
 * for; getting the two out of step gives a matrix that still converges to
 * something diagonal, just not to this matrix's eigenvalues.
 */
const OFF_DIAGONAL_EPS = 1e-30

function jacobiEigen(input: number[][], n: number): { values: number[]; vectors: number[][] } {
  const a = input.map(r => r.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q]
    // Relative to the diagonal, so the test means the same thing on counts of
    // 10 and counts of 10 million. Both sides are sums of SQUARES, so a
    // tolerance of 1e-30 here is a relative tolerance of 1e-15 on the values —
    // about machine epsilon, which is as far as this can usefully converge.
    let scale = 0
    for (let p = 0; p < n; p++) scale += a[p][p] * a[p][p]
    if (off <= Math.max(scale, 1) * OFF_DIAGONAL_EPS) break

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        // sign(0) is 0, and a zero t is no rotation at all — the one case where
        // the pivot most needs one, because it means a[p][p] === a[q][q].
        const sign = theta >= 0 ? 1 : -1
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c

        for (let k = 0; k < n; k++) {          // A ← A·J
          const kp = a[k][p], kq = a[k][q]
          a[k][p] = c * kp - s * kq
          a[k][q] = s * kp + c * kq
        }
        for (let k = 0; k < n; k++) {          // A ← Jᵀ·A
          const pk = a[p][k], qk = a[q][k]
          a[p][k] = c * pk - s * qk
          a[q][k] = s * pk + c * qk
        }
        for (let k = 0; k < n; k++) {          // V ← V·J
          const kp = v[k][p], kq = v[k][q]
          v[k][p] = c * kp - s * kq
          v[k][q] = s * kp + c * kq
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v }
}

export interface PCAOptions {
  /** Genes kept, by variance across the samples given. DESeq2's `ntop`. */
  ntop?: number
}

/**
 * Principal components of the samples in `cols`.
 *
 * @param values  row-major genes × samples, as CountsMatrix holds them
 * @param S       the matrix's sample stride, NOT the number of samples wanted
 * @param cols    which columns to include, in the order to report them
 * @param names   their names, parallel to `cols`
 */
export function pca(
  values: Float64Array,
  S: number,
  cols: number[],
  names: string[],
  opts: PCAOptions = {},
): PCAResult {
  const ntop = opts.ntop ?? 500
  const m = cols.length
  const empty: PCAResult = { samples: names, scores: names.map(() => []), varFrac: [], nPC: 0, nGenes: 0, nVarying: 0 }
  // Two samples give one component and a line through two points, which is a
  // picture of nothing. One gives not even that.
  if (m < 2) return empty
  const nGenesTotal = Math.floor(values.length / S)

  /**
   * Per-gene variance across these samples, on the logged values.
   *
   * The order matters and is the same as DESeq2's: the transform comes first
   * and the variance is measured on the transformed values, because a variance
   * ranking on raw counts is a ranking on expression level — the mean-variance
   * relationship of count data guarantees the highest-expressed genes are the
   * most variable ones, so the "500 most variable genes" would be the 500
   * largest genes and PC1 would be library composition every time.
   */
  const logged = new Float64Array(nGenesTotal * m)
  const vars = new Float64Array(nGenesTotal)
  for (let g = 0; g < nGenesTotal; g++) {
    const at = g * m
    let sum = 0
    for (let j = 0; j < m; j++) {
      const raw = values[g * S + cols[j]]
      const lv = Number.isFinite(raw) ? Math.log2(Math.max(raw, 0) + 1) : 0
      logged[at + j] = lv
      sum += lv
    }
    const mean = sum / m
    let ss = 0
    for (let j = 0; j < m; j++) { const d = logged[at + j] - mean; ss += d * d }
    vars[g] = ss / (m - 1)
  }

  // Genes that do not vary carry no information and would only be a tie-break
  // in the ranking below, so they are dropped rather than ranked.
  const varying: number[] = []
  for (let g = 0; g < nGenesTotal; g++) if (vars[g] > 0) varying.push(g)
  if (!varying.length) return { ...empty, nVarying: 0 }

  // Descending by variance, with the gene index as a deterministic tie-break —
  // ties are common on a small experiment, and a PCA that depends on sort
  // stability is a PCA that can move between browsers.
  varying.sort((a, b) => vars[b] - vars[a] || a - b)
  // No floor. There was a `Math.max(2, …)` here, which silently overrode the
  // caller: asking for the single most variable gene got two, so the control
  // that says "top N genes" did not mean what it said at its own lower end. One
  // gene is a perfectly good PCA — it is a line, and the line is the answer.
  const keep = varying.slice(0, Math.min(ntop, varying.length))

  // X: samples × kept genes, each gene centred across the samples.
  const G = keep.length
  const X = new Float64Array(m * G)
  for (let k = 0; k < G; k++) {
    const at = keep[k] * m
    let sum = 0
    for (let j = 0; j < m; j++) sum += logged[at + j]
    const mean = sum / m
    for (let j = 0; j < m; j++) X[j * G + k] = logged[at + j] - mean
  }

  /**
   * The Gram matrix XXᵀ, which is m × m — not the m × m covariance of the
   * genes, which would be 500 × 500.
   *
   * X = UDVᵀ, so XXᵀ = UD²Uᵀ: the sample-space eigenvectors and the SQUARED
   * singular values, which is everything the scores and the percentages need.
   * The gene loadings live in V and are not computed, because nothing on the
   * figure asks for them.
   */
  const gram: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = i; j < m; j++) {
      let acc = 0
      for (let k = 0; k < G; k++) acc += X[i * G + k] * X[j * G + k]
      gram[i][j] = acc
      gram[j][i] = acc
    }
  }

  const { values: lam, vectors } = jacobiEigen(gram, m)
  const order = lam.map((_, i) => i).sort((a, b) => lam[b] - lam[a])
  // Negative eigenvalues are rounding around zero on the null component.
  const total = order.reduce((a, i) => a + Math.max(lam[i], 0), 0)

  const nPC = Math.min(m - 1, G)
  const scores: number[][] = Array.from({ length: m }, () => new Array<number>(nPC).fill(0))
  const varFrac: number[] = []
  for (let k = 0; k < nPC; k++) {
    const c = order[k]
    const l = Math.max(lam[c], 0)
    const sd = Math.sqrt(l)
    /**
     * A deterministic sign.
     *
     * An eigenvector and its negation are equally valid, and Jacobi's choice
     * depends on the order rotations happened to be applied in. Left alone, the
     * same data can draw with the groups on opposite sides of PC1 on two
     * different days — nothing is wrong with the figure and nobody can tell
     * that from looking at it. Pinned by making the FIRST coordinate of largest
     * magnitude positive.
     *
     * "First" is doing real work and is not a tidy-up. A symmetric layout ties
     * on magnitude — three samples landing at −1, 0, +1 have two coordinates
     * equally largest, and a rule that says only "the largest" leaves the answer
     * to whichever the comparison happened to visit last. The strict `>` below
     * keeps the earliest, which makes the rule total: it depends on the data and
     * on the sample order the caller asked for, and on nothing inside the solver.
     */
    let big = 0
    for (let i = 1; i < m; i++) if (Math.abs(vectors[i][c]) > Math.abs(vectors[big][c])) big = i
    const flip = vectors[big][c] < 0 ? -1 : 1
    for (let i = 0; i < m; i++) scores[i][k] = flip * vectors[i][c] * sd
    varFrac.push(total > 0 ? l / total : 0)
  }

  return { samples: names, scores, varFrac, nPC, nGenes: G, nVarying: varying.length }
}
