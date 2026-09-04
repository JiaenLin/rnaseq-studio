// Cross-block comparison: the numbers, checked against R where R can be asked.
//
// This module exists so a reader can ask "does ageing do the same thing in
// heart as in liver" without a model that spans them. Every claim it makes is
// a real statistical claim, so the arithmetic is checked rather than trusted.
import { upperTail, twoSided, bh, compareResponses, blockOfCondition, spansBlocks } from '../src/lib/crossblock.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const close = (name, got, want, tol) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${got}  want ${want} (+-${tol})`}`)
}
const rel = (name, got, want, tol) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol * Math.abs(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${got}  want ${want} (rel ${tol})`}`)
}

console.log('\nTHE NORMAL TAIL')
// R: pnorm(z, lower.tail = FALSE), printed to 17 digits.
const R_UPPER = {
  0: 0.5,
  0.5: 0.30853753872598688,
  1: 0.15865525393145705,
  1.959963984540054: 0.024999999999999925,
  2.5: 0.0062096653257761009,
  3: 0.0013498980316300946,
  5: 2.8665157187919333e-07,
  7: 1.2798125438858348e-12,
  10: 7.6198530241605945e-24,
  20: 2.7536241186062336e-89,
  30: 4.9063189936762015e-198,
}
// Tolerance by what the number is FOR. Out to z = 20 — past any p-value a
// reader will ever look at — the approximation is good to ~3e-9 relative, which
// is far tighter than needed for thresholding or for ranking genes. Beyond
// that it drifts to ~1e-4 relative at z = 30, where the p-value is 5e-198 and
// the difference between that and 4.9e-198 is of no consequence to anyone.
// Demanding 1e-12 everywhere would only be asserting that a closed form is
// something it is not.
for (const [z, want] of Object.entries(R_UPPER)) {
  rel(`P(Z > ${z}) matches R`, upperTail(Number(z)), want, Number(z) <= 20 ? 1e-8 : 1e-3)
}
check('the far tail underflows to 0 rather than NaN', upperTail(40), 0)
check('symmetric in the sign of z', upperTail(-3), upperTail(3))
close('two-sided at 1.96 is 0.05', twoSided(1.959963984540054), 0.05, 1e-12)
check('a non-finite statistic gives NaN', Number.isNaN(twoSided(NaN)), true)

console.log('\nBENJAMINI-HOCHBERG')
// R: p.adjust(c(0.001,0.008,0.039,0.041,0.042,0.06,0.074,0.205,0.212,0.216), "BH")
const P = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
// Verbatim from R: p.adjust(P, "BH") printed at %.17g.
const WANT = [0.01, 0.040000000000000001, 0.084000000000000005, 0.084000000000000005,
  0.084000000000000005, 0.10000000000000001, 0.10571428571428571, 0.216, 0.216, 0.216]
bh(P).forEach((g, i) => rel(`BH[${i}] matches R p.adjust`, g, WANT[i], 1e-12))
// Unsorted input, because the adjusted values must come back in INPUT order —
// a version that returned them sorted would look right on a sorted example.
const U = [0.5, 0.01, 0.2, 0.001]
const WANT_U = [0.5, 0.02, 0.26666666666666666, 0.0040000000000000001]
bh(U).forEach((g, i) => rel(`BH of unsorted input [${i}] matches R`, g, WANT_U[i], 1e-12))
check('NaN p-values stay NaN and do not enter the count',
  bh([0.01, NaN, 0.02]).map(x => Number.isNaN(x)), [false, true, false])

console.log('\nBLOCKS')
const bundle = {
  meta: { block_factor: 'tissue', conditions: ['Liver_008w', 'Liver_104w', 'Heart_008w'] },
  samples: [
    { sample: 'a', condition: 'Liver_008w', tissue: 'Liver' },
    { sample: 'b', condition: 'Liver_104w', tissue: 'Liver' },
    { sample: 'c', condition: 'Heart_008w', tissue: 'Heart' },
  ],
}
const bo = blockOfCondition(bundle)
check('conditions map to their block', [...bo.entries()],
  [['Liver_008w', 'Liver'], ['Liver_104w', 'Liver'], ['Heart_008w', 'Heart']])
check('a within-block pair does not span', spansBlocks(bo, ['Liver_008w'], ['Liver_104w']), false)
check('a cross-block pair does', spansBlocks(bo, ['Liver_008w'], ['Heart_008w']), true)
check('an unblocked bundle has no blocks',
  blockOfCondition({ meta: {}, samples: bundle.samples }).size, 0)

console.log('\nTHE INTERACTION')
const row = (id, lfc, se, padj = 0.001, mle = true) => ({
  gene_id: id, gene_name: id, baseMean: 100,
  log2FoldChange: lfc, lfcSE: se, pvalue: 0.001, padj,
  ...(mle ? { log2FoldChange_MLE: lfc, lfcSE_MLE: se } : {}),
})
{
  // Same effect in both blocks -> no interaction. Opposite -> a big one.
  const A = [row('same', 2, 0.2), row('flip', 2, 0.2), row('quiet', 0.1, 0.2)]
  const B = [row('same', 2, 0.2), row('flip', -2, 0.2), row('quiet', 0.1, 0.2)]
  const c = compareResponses(A, B)
  check('every gene tested in both is compared', c.genes.length, 3)
  const g = Object.fromEntries(c.genes.map(x => [x.gene_id, x]))
  close('an identical response has delta 0', g.same.delta, 0, 1e-12)
  close('and z 0', g.same.z, 0, 1e-12)
  close('an opposite response has delta 4', g.flip.delta, 4, 1e-12)
  // SE of the difference is sqrt(0.2^2 + 0.2^2) = 0.28284271
  close('SE of the difference adds in quadrature', g.flip.delta / g.flip.z, Math.SQRT2 * 0.2, 1e-9)
  check('the flipped gene is the significant interaction', c.nInteraction, 1)
  check('the MLE columns were used', c.usedMLE, true)
}
{
  // A bundle without MLE columns must still compare, and must say it could not
  // use them — silently falling back would be the failure this guards.
  const A = [row('g1', 2, 0.2, 0.001, false), row('g2', 1, 0.2, 0.001, false)]
  const B = [row('g1', 1, 0.2, 0.001, false), row('g2', 1, 0.2, 0.001, false)]
  const c = compareResponses(A, B)
  check('an older bundle still compares', c.genes.length, 2)
  check('and says the MLE was unavailable', c.usedMLE, false)
}

console.log('\nWHAT WAS NOT TESTED')
{
  const A = [row('both', 1, 0.2), row('liverOnly', 3, 0.2)]
  const B = [row('both', 1, 0.2), row('heartOnly', 3, 0.2)]
  // padj NA means independent filtering dropped it: never tested, not unchanged.
  A.push({ ...row('filtered', 5, 0.2), padj: null })
  const c = compareResponses(A, B)
  check('only genes tested in both are compared', c.genes.map(g => g.gene_id), ['both'])
  check('a gene tested only in A is reported, not dropped', c.onlyA, ['liverOnly'])
  check('and one tested only in B likewise', c.onlyB, ['heartOnly'])
  check('a padj of NA is not "tested"', c.genes.concat().some(g => g.gene_id === 'filtered'), false)
  check('nor does it count as A-only by accident', c.onlyA.includes('filtered'), false)
}

console.log('\nCONCORDANCE AND SLOPE')
{
  // B responds at exactly half of A, with equal errors: Deming should say 0.5.
  const A = [], B = []
  for (let i = 0; i < 200; i++) {
    const v = -3 + (6 * i) / 199
    A.push(row(`g${i}`, v, 0.1))
    B.push(row(`g${i}`, v / 2, 0.1))
  }
  const c = compareResponses(A, B)
  close('a perfectly concordant pair has Pearson 1', c.pearson, 1, 1e-9)
  close('and Spearman 1', c.spearman, 1, 1e-9)
  close('the slope recovers the true halving', c.slope, 0.5, 1e-6)
  // Direction, not just correlation: a flipped block must read as anti-correlated.
  const Bneg = A.map((r, i) => row(`g${i}`, -r.log2FoldChange, 0.1))
  close('an opposite block has Pearson -1', compareResponses(A, Bneg).pearson, -1, 1e-9)
}
{
  // Regression dilution is the reason for Deming: with noisy x, OLS is
  // attenuated. Same truth (slope 1), but a large error on x.
  let s = 3
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const gs = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
  const A = [], B = []
  for (let i = 0; i < 3000; i++) {
    const truth = gs() * 1.5
    A.push(row(`g${i}`, truth + gs() * 0.8, 0.8))
    B.push(row(`g${i}`, truth + gs() * 0.8, 0.8))
  }
  const c = compareResponses(A, B)
  const x = c.genes.map(g => g.lfcA), y = c.genes.map(g => g.lfcB)
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length
  let sxy = 0, sxx = 0
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  const ols = sxy / sxx
  console.log(`  ..   OLS slope ${ols.toFixed(3)} (attenuated) vs Deming ${c.slope.toFixed(3)} (truth 1.0)`)
  check('OLS is visibly attenuated below the truth', ols < 0.9, true)
  check('Deming is much closer to it', Math.abs(c.slope - 1) < Math.abs(ols - 1), true)
}

console.log('\nQUADRANTS')
{
  const A = [row('uu', 2, 0.2), row('ud', 2, 0.2), row('du', -2, 0.2), row('dd', -2, 0.2),
    row('ns', 2, 0.2, 0.9)]
  const B = [row('uu', 2, 0.2), row('ud', -2, 0.2), row('du', 2, 0.2), row('dd', -2, 0.2),
    row('ns', 2, 0.2, 0.9)]
  const c = compareResponses(A, B)
  check('significant genes land in the right quadrants', c.quadrants,
    { upUp: 1, upDown: 1, downUp: 1, downDown: 1 })
  check('a gene significant in neither is in no quadrant',
    c.quadrants.upUp + c.quadrants.upDown + c.quadrants.downUp + c.quadrants.downDown, 4)
}

console.log(failed ? `\n${failed} cross-block test(s) failed\n` : '\nAll cross-block tests passed\n')
process.exit(failed ? 1 : 0)
