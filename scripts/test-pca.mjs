// The PCA, against things that have a right answer.
//
// A PCA is easy to write and hard to check by looking at: a wrong sign, a
// missing centring or a variance ranking done before the transform all produce
// a scatter plot that looks entirely plausible. So none of the assertions below
// is "the picture looks right" — they are invariants a correct decomposition
// must satisfy and an incorrect one generally will not.

import { pca } from '../src/lib/pca.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const near = (name, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${got}\n        want ${want} ± ${tol}`))
}

/** Build a genes × samples matrix from rows given as raw (un-logged) counts. */
const mat = rows => {
  const S = rows[0].length
  const v = new Float64Array(rows.length * S)
  rows.forEach((r, i) => r.forEach((x, j) => { v[i * S + j] = x }))
  return { values: v, S }
}
const names = n => Array.from({ length: n }, (_, i) => `S${i + 1}`)
const cols = n => Array.from({ length: n }, (_, i) => i)

console.log('\nA DECOMPOSITION THAT IS ACTUALLY A DECOMPOSITION')
{
  // Four samples, two groups, genes that separate them plus genes that do not.
  const rows = [
    [100, 110, 900, 950],
    [200, 190, 20, 25],
    [50, 52, 48, 51],
    [10, 40, 12, 38],      // a second axis, orthogonal to the group split and weaker
    [5, 5, 5, 5],          // no variance at all
  ]
  const { values, S } = mat(rows)
  const r = pca(values, S, cols(4), names(4), { ntop: 500 })

  check('the zero-variance gene is dropped', r.nVarying, 4)
  check('and the rest are kept', r.nGenes, 4)
  // Centring the genes makes the sample columns sum to zero, so the rank is at
  // most S − 1. Offering the fourth component would be offering rounding error.
  check('rank is S − 1', r.nPC, 3)
  near('the variance fractions sum to 1', r.varFrac.reduce((a, b) => a + b, 0), 1, 1e-12)
  check('and are in descending order',
    r.varFrac.every((v, i) => i === 0 || v <= r.varFrac[i - 1] + 1e-12), true)

  // The scores are a ROTATION of the centred data, so they must preserve every
  // pairwise distance exactly. This is the assertion that catches a bad
  // rotation, a mis-scaled eigenvector, or eigenvalues paired with the wrong
  // vectors — all of which still draw a believable scatter plot.
  const S4 = 4
  const logged = rows.map(r0 => r0.map(x => Math.log2(x + 1)))
  const centred = logged.filter(r0 => new Set(r0).size > 1)
    .map(r0 => { const m = r0.reduce((a, b) => a + b, 0) / S4; return r0.map(x => x - m) })
  const dataDist = (i, j) => Math.sqrt(centred.reduce((a, g) => a + (g[i] - g[j]) ** 2, 0))
  const scoreDist = (i, j) =>
    Math.sqrt(r.scores[i].reduce((a, _, k) => a + (r.scores[i][k] - r.scores[j][k]) ** 2, 0))
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      near(`distance S${i + 1}–S${j + 1} survives the projection`, scoreDist(i, j), dataDist(i, j), 1e-8)
    }
  }

  // Every component is centred, because every gene was.
  for (let k = 0; k < r.nPC; k++) {
    near(`PC${k + 1} is centred`, r.scores.reduce((a, s) => a + s[k], 0), 0, 1e-9)
  }
  // And the components are orthogonal to each other.
  for (let k = 0; k < r.nPC; k++) {
    for (let l = k + 1; l < r.nPC; l++) {
      near(`PC${k + 1} ⟂ PC${l + 1}`,
        r.scores.reduce((a, s) => a + s[k] * s[l], 0), 0, 1e-8)
    }
  }
  // The group split is the dominant signal here, so PC1 has to find it.
  const sameSide = Math.sign(r.scores[0][0]) === Math.sign(r.scores[1][0])
    && Math.sign(r.scores[2][0]) === Math.sign(r.scores[3][0])
    && Math.sign(r.scores[0][0]) !== Math.sign(r.scores[2][0])
  check('PC1 separates the two groups', sameSide, true)
}

console.log('\nA KNOWN ANSWER, WORKED BY HAND')
{
  // One gene varying, three samples. After log2(x+1) the values are 1, 2, 3;
  // centred they are −1, 0, 1. That is the whole of the data, so PC1 must BE
  // those numbers (up to the fixed sign) and must carry all the variance.
  const { values, S } = mat([[1, 3, 7], [4, 4, 4]])
  const r = pca(values, S, cols(3), names(3))
  check('one varying gene', r.nGenes, 1)
  // rank ≤ min(S − 1, G) = min(2, 1) = 1.
  check('one real component', r.nPC, 1)
  near('which carries everything', r.varFrac[0], 1, 1e-12)
  // The values are −1, 0, +1 up to sign, and the sign rule picks the FIRST
  // coordinate of largest magnitude — which ties here between S1 and S3 — and
  // makes it positive. So S1 is +1. The tie is the point: this asserts the rule
  // is total, not just that it exists.
  near('S1 sits at +1', r.scores[0][0], 1, 1e-12)
  near('S2 at 0', r.scores[1][0], 0, 1e-12)
  near('S3 at −1', r.scores[2][0], -1, 1e-12)
}

console.log('\nntop RANKS ON THE LOGGED VALUES, NOT THE COUNTS')
{
  // The order these two steps happen in is the whole reason plotPCA has an
  // ntop at all. `big` swings 20000 → 21000 in raw counts, a variance of half a
  // million, and 14.29 → 14.36 after the log. `small` swings 1 → 60, a raw
  // variance of 1741 — 300× smaller — and 1.00 → 5.93 after it. Ranking on raw
  // counts keeps `big`, which is a gene doing nothing; ranking on the logged
  // values keeps `small`, which is the gene with the experiment in it.
  const { values, S } = mat([
    [20000, 21000, 20000, 21000],   // big
    [1, 60, 1, 60],                 // small
  ])
  const r = pca(values, S, cols(4), names(4), { ntop: 1 })
  check('exactly one gene entered', r.nGenes, 1)
  // With `small` chosen, the four samples land on two points 4.93 apart.
  const spread = Math.abs(r.scores[0][0] - r.scores[1][0])
  near('and it is the one that swings on the log scale', spread, Math.log2(61) - Math.log2(2), 1e-9)
}

console.log('\nntop IS A CEILING, NOT A PROMISE')
{
  const { values, S } = mat([[1, 5, 9], [2, 2, 8], [3, 3, 3]])
  const r = pca(values, S, cols(3), names(3), { ntop: 500 })
  check('asking for 500 of 2 varying genes gives 2', r.nGenes, 2)
  check('and reports how many there were', r.nVarying, 2)
}

console.log('\nTHE SIGN IS PINNED')
{
  // The same data twice must give the same picture — an eigenvector and its
  // negation are both correct, and "correct" is not enough for a figure that
  // goes in a paper.
  const { values, S } = mat([[1, 3, 7, 2], [9, 2, 4, 8], [3, 3, 9, 1]])
  const a = pca(values, S, cols(4), names(4))
  const b = pca(values, S, cols(4), names(4))
  check('two runs agree exactly', a.scores, b.scores)
  for (let k = 0; k < a.nPC; k++) {
    let big = 0
    for (let i = 1; i < 4; i++) if (Math.abs(a.scores[i][k]) > Math.abs(a.scores[big][k])) big = i
    check(`PC${k + 1}'s largest coordinate is positive`, a.scores[big][k] > 0, true)
  }
}

console.log('\nSUBSETTING, AND THE DEGENERATE CASES')
{
  const { values, S } = mat([[1, 3, 7, 2, 6], [9, 2, 4, 8, 5], [3, 3, 9, 1, 4]])
  // Columns are read in the order given, so a caller that groups its samples
  // gets rows back in that same order.
  const r = pca(values, S, [4, 0, 2], ['E', 'A', 'C'])
  check('the samples come back as asked', r.samples, ['E', 'A', 'C'])
  check('three samples, two components', r.nPC, 2)

  const one = pca(values, S, [0], ['A'])
  check('one sample is not a PCA', one.nPC, 0)
  const flat = pca(mat([[5, 5, 5], [2, 2, 2]]).values, 3, cols(3), names(3))
  check('a matrix with no variance is not either', flat.nPC, 0)
  check('and it says so rather than dividing by zero', flat.varFrac, [])
}

console.log('\nA WIDE MATRIX STAYS FAST')
{
  // The Gram matrix is samples × samples, never genes × genes, which is what
  // makes this affordable on a real transcriptome. 20 000 genes × 12 samples.
  const G = 20000, m = 12
  const v = new Float64Array(G * m)
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let g = 0; g < G; g++) for (let j = 0; j < m; j++) v[g * m + j] = rnd() * 1000 * (1 + (j < 6 ? 0 : 0.4))
  const t0 = performance.now()
  const r = pca(v, m, cols(m), names(m))
  const ms = performance.now() - t0
  check('500 genes entered', r.nGenes, 500)
  check('11 components', r.nPC, 11)
  check(`under 500 ms (took ${ms.toFixed(0)} ms)`, ms < 500, true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll PCA tests passed\n')
process.exit(failed ? 1 : 0)
