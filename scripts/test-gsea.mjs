// The pre-ranked GSEA maths.
//
// The running-sum statistic has a closed form at its turning points and a naive
// walk over all N ranks to compare against, so the fast version can be checked
// against the slow one exactly rather than "looks about right". Everything else
// here pins a property that would otherwise only be visible as a wrong number in
// a figure: which way the sign points, what the leading edge contains, and that
// two runs of the same analysis agree.

import {
  RANK_METRICS, canRank, enrichmentScore, rankGenes, runGsea, runningCurve, setsFromIndex,
} from '../src/lib/gsea.ts'
import { indexFor, parseSets } from '../src/lib/msigdb.ts'

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

/** The definition, walked one rank at a time. Slow on purpose. */
function esNaive(positions, weights, n) {
  const k = positions.length
  const hit = new Set(positions)
  let nr = 0
  for (const p of positions) nr += weights[p]
  const miss = 1 / (n - k)
  let run = 0, best = 0, peak = -1
  for (let i = 0; i < n; i++) {
    run += hit.has(i) ? weights[i] / nr : -miss
    if (Math.abs(run) > Math.abs(best)) { best = run; peak = i }
  }
  return { es: best, peak }
}

const row = (name, lfc, p, se = 0.2) =>
  ({ gene_id: name, gene_name: name, baseMean: 100, log2FoldChange: lfc, lfcSE: se, pvalue: p, padj: p })

console.log('\nTHE FAST RUNNING SUM IS THE SLOW ONE')
{
  // Only where it turns, versus every rank. They must agree to the bit, because
  // the fast one is what every permutation uses and the slow one is the
  // definition in the paper.
  let seed = 99
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const n = 500
  const weights = new Float64Array(n)
  for (let i = 0; i < n; i++) weights[i] = Math.abs(3 - (6 * i) / n) + rnd() * 0.4
  let worst = 0, mismatchedPeaks = 0
  for (let t = 0; t < 60; t++) {
    const k = 5 + Math.floor(rnd() * 80)
    const pick = new Set()
    while (pick.size < k) pick.add(Math.floor(rnd() * n))
    const pos = Int32Array.from([...pick].sort((a, b) => a - b))
    let nr = 0
    for (const p of pos) nr += weights[p]
    const fast = enrichmentScore(pos, weights, n, nr)
    const slow = esNaive(pos, weights, n)
    worst = Math.max(worst, Math.abs(fast.es - slow.es))
    // A negative ES peaks just BEFORE a hit, so the naive walk reports the rank
    // one step earlier; both name the same trough.
    if (fast.peak !== slow.peak && fast.peak - 1 !== slow.peak) mismatchedPeaks++
  }
  near('60 random sets, identical ES', worst, 0, 1e-12)
  check('and the same peak', mismatchedPeaks, 0)
}

console.log('\nWHICH WAY THE SIGN POINTS')
{
  const n = 200
  const weights = new Float64Array(n).fill(1)
  const top = Int32Array.from({ length: 20 }, (_, i) => i)
  const bottom = Int32Array.from({ length: 20 }, (_, i) => n - 20 + i)
  const spread = Int32Array.from({ length: 20 }, (_, i) => i * 10)
  const es = p => enrichmentScore(p, weights, n, p.length).es
  check('a set at the top of the ranking scores positive', es(top) > 0.9, true)
  check('a set at the bottom scores negative', es(bottom) < -0.9, true)
  check('a set spread evenly scores near zero', Math.abs(es(spread)) < 0.15, true)
  // Perfectly at the top with equal weights: the sum reaches 1 before any miss.
  near('a set that IS the top of the list scores 1', es(top), 1, 1e-12)
}

console.log('\nTHE RANKING')
{
  const rows = [
    row('AAA', 3, 1e-8), row('BBB', -2, 1e-4), row('CCC', 0.1, 0.9),
    row('DDD', 1, 0.01, 0.5), row('NOSE', 2, 0.001, null),
  ]
  const byStat = rankGenes(rows, 'stat')
  // stat = log2FC / lfcSE: AAA 15, DDD 2, CCC 0.5, BBB -10. NOSE has no lfcSE.
  check('ranked by the Wald statistic', byStat.genes, ['AAA', 'DDD', 'CCC', 'BBB'])
  check('and a gene with no lfcSE is dropped, counted', byStat.dropped, 1)
  check('log2FC ranks differently', rankGenes(rows, 'log2FC').genes,
    ['AAA', 'NOSE', 'DDD', 'CCC', 'BBB'])
  check('the weights are |score|', Array.from(byStat.weights.slice(0, 2)), [15, 2])
  check('rankOf points back into the list', byStat.rankOf.get('BBB'), 3)

  // The bundle's spelling is kept beside the upper-case key, so a mouse result
  // reads as mouse — the same rule the enrichment drill-down now follows.
  const mouse = rankGenes([row('Cyld', 2, 1e-5), row('Il10', -1, 1e-3)], 'stat')
  check('keys are upper case', mouse.genes, ['CYLD', 'IL10'])
  check('labels are the bundle’s', mouse.labels, ['Cyld', 'Il10'])

  check('every metric is offered with a description',
    RANK_METRICS.every(m => m.label && m.blurb), true)
  check('a table with no lfcSE cannot be ranked by the statistic',
    canRank([row('X', 1, 0.01, null)], 'stat'), false)
  check('but can be by the combined score',
    canRank([row('X', 1, 0.01, null)], 'combined'), true)
}

console.log('\nTIES DO NOT DEPEND ON THE FILE’S ORDER')
{
  // Array.prototype.sort is stable, so without an explicit tie-break the
  // ranking would follow the order the exporter happened to write its rows —
  // and a running-sum statistic reads that difference.
  const a = rankGenes([row('BBB', 1, 0.01), row('AAA', 1, 0.01), row('CCC', 1, 0.01)], 'log2FC')
  const b = rankGenes([row('CCC', 1, 0.01), row('BBB', 1, 0.01), row('AAA', 1, 0.01)], 'log2FC')
  check('the same tied genes rank the same way', a.genes, b.genes)
  check('alphabetically', a.genes, ['AAA', 'BBB', 'CCC'])
}

console.log('\nEND TO END, ON A RANKING WITH A PLANTED SIGNAL')
{
  const N = 600
  const rows = []
  for (let i = 0; i < N; i++) {
    const name = `G${String(i).padStart(4, '0')}`
    // A smooth ranking; the planted set is the top 30 genes.
    rows.push(row(name, 4 - (8 * i) / N, 0.01))
  }
  const members = Array.from({ length: 30 }, (_, i) => `G${String(i).padStart(4, '0')}`)
  const bottomers = Array.from({ length: 30 }, (_, i) => `G${String(N - 1 - i).padStart(4, '0')}`)
  const scattered = Array.from({ length: 30 }, (_, i) => `G${String(i * 20).padStart(4, '0')}`)
  const gmt = [
    ['TOP', 'x', ...members].join('\t'),
    ['BOTTOM', 'x', ...bottomers].join('\t'),
    ['SCATTERED', 'x', ...scattered].join('\t'),
  ].join('\n') + '\n'

  const ranking = rankGenes(rows, 'log2FC')
  check('every gene ranked', ranking.genes.length, N)
  const index = indexFor([parseSets(gmt, 'T')], rows.map(r => r.gene_name))
  const sets = setsFromIndex(index, ranking, 10, 500)
  check('all three sets mapped', sets.length, 3)

  const res = await runGsea(ranking, sets, { nperm: 400 })
  const by = Object.fromEntries(res.map(r => [r.id, r]))
  check('the planted top set is positive', by.TOP.es > 0.9, true)
  check('its NES is positive and large', by.TOP.nes > 2, true)
  check('the planted bottom set is negative', by.BOTTOM.es < -0.9, true)
  check('the scattered set is not enriched', Math.abs(by.SCATTERED.nes) < 1.6, true)
  check('the signal beats the noise after correction',
    by.TOP.padj < 0.05 && by.SCATTERED.padj > by.TOP.padj, true)
  // A permutation p-value of zero is a lie: it means "none of 400 draws beat
  // it", which is a bound, not a certainty.
  check('no p-value is zero', res.every(r => r.pvalue > 0), true)
  check('nor greater than one', res.every(r => r.pvalue <= 1), true)

  // The leading edge is the part of the set that produced the score.
  check('the top set’s leading edge is its members up to the peak',
    by.TOP.leadingEdge.length, 30)
  check('and they are the bundle’s spelling', by.TOP.leadingEdge[0], 'G0000')
  check('the bottom set’s leading edge runs from the other end',
    by.BOTTOM.leadingEdge.includes(`G${String(N - 1).padStart(4, '0')}`), true)

  // Same input, same answer — a Methods paragraph quoting a p-value that moves
  // between runs is worse than one quoting nothing.
  const again = await runGsea(ranking, sets, { nperm: 400 })
  check('the same analysis twice gives the same numbers',
    again.map(r => [r.id, r.es, r.nes, r.pvalue]),
    res.map(r => [r.id, r.es, r.nes, r.pvalue]))

  const curve = runningCurve(sets.find(s => s.id === 'TOP').positions, ranking.weights, N)
  check('the curve starts at zero', Math.abs(curve.y[0]) < 0.2, true)
  check('and ends there', Math.abs(curve.y[curve.y.length - 1]) < 1e-9, true)
  check('and reaches the ES somewhere in between',
    Math.max(...curve.y) > 0.9, true)
}

console.log('\nSETS THE WINDOW EXCLUDES ARE NOT TESTED')
{
  const rows = Array.from({ length: 100 }, (_, i) =>
    row(`G${String(i).padStart(3, '0')}`, 2 - i / 25, 0.01))
  const ranking = rankGenes(rows, 'log2FC')
  const gmt = ['TINY\tx\tG000\tG001\tG002', 'FINE\tx\t' + rows.slice(0, 20).map(r => r.gene_name).join('\t')].join('\n')
  const index = indexFor([parseSets(gmt, 'T')], rows.map(r => r.gene_name))
  check('the window is applied to what mapped',
    setsFromIndex(index, ranking, 10, 500).map(s => s.id), ['FINE'])
  check('and a wider floor lets the small one in',
    setsFromIndex(index, ranking, 3, 500).map(s => s.id).sort(), ['FINE', 'TINY'])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll GSEA tests passed\n')
process.exit(failed ? 1 : 0)
