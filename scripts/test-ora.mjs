// The enrichment maths, after the library moved from the bundle to the studio.
//
// Two things changed and both are numerical, so both are pinned here rather
// than left to look right on screen: the hypergeometric tail is summed in log
// space, and there is a second, indexed implementation of the same test that
// has to agree with the reference exactly.

import { bh, bhNlp, hyperTail, logHyperTail, oraIndexed, runORA, prepareSets } from '../src/lib/ora.ts'
import { indexFor, parseSets } from '../src/lib/msigdb.ts'
import { speciesOfMeta } from '../src/lib/species.ts'

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

console.log('\nTHE TAIL, WHERE A DOUBLE RUNS OUT')
{
  // The defect the log-space form exists for. It was survivable while a bundle
  // carried five collections; across MSigDB's 35 361 the sets that underflow
  // are the ones a reader is looking for, and padj was the sort key.
  check('the double underflows to exactly zero', hyperTail(600, 700, 4000, 22000), 0)
  const lp = logHyperTail(600, 700, 4000, 22000)
  check('the log does not', Number.isFinite(lp) && lp < -700, true)
  near('and says how far past zero it is', -lp / Math.LN10, 345.41, 0.05)
  check('two underflowed sets are still ordered',
    -logHyperTail(700, 700, 4000, 22000) > -logHyperTail(600, 700, 4000, 22000), true)

  // Where the double holds the answer, the two must agree — this is one sum
  // rewritten, not a second opinion about it.
  for (const [k, K, n, N] of [[3, 10, 20, 100], [2, 5, 8, 20], [1, 1, 1, 2], [12, 40, 300, 5000]]) {
    near(`log and linear agree at k=${k},K=${K},n=${n},N=${N}`,
      Math.exp(logHyperTail(k, K, n, N)), hyperTail(k, K, n, N), 1e-12)
  }
  near('a known tail is unchanged', hyperTail(3, 10, 20, 100), 0.3187799361823111, 1e-9)
}

console.log('\nBH IN BOTH SPACES IS ONE STEP-UP')
{
  const ps = [1e-9, 2e-4, 0.03, 0.2, 0.5, 0.9, 0.011, 0.047]
  const adj = bh(ps)
  const adjN = bhNlp(ps.map(v => -Math.log10(v)))
  for (let i = 0; i < ps.length; i++) {
    near(`set ${i} agrees between bh and bhNlp`, adjN[i], -Math.log10(adj[i]), 1e-9)
  }
}

console.log('\nTHE INDEXED PATH EQUALS THE REFERENCE')
{
  // Same library, same query, two implementations: runORA walks every gene of
  // every set, oraIndexed walks the query. They must not merely rank the same.
  const defs = [
    { source: 'A', id: 's1', name: 'one', genes: ['G1', 'G2', 'G3', 'G4', 'G5'] },
    { source: 'A', id: 's2', name: 'two', genes: ['G4', 'G5', 'G6', 'G7'] },
    { source: 'B', id: 's3', name: 'three', genes: ['G8', 'G9', 'G10', 'G1', 'G2'] },
    { source: 'B', id: 's4', name: 'four', genes: ['G11', 'G12', 'G13'] },
  ]
  const bg = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'ZZ1', 'ZZ2']
  const query = ['G1', 'G2', 'G4', 'G8', 'G11']

  // A real GMT: name, a description column, then the members. The empty second
  // field is what marks it as a description rather than the first gene — see
  // looksLikeDescription in msigdb.ts, which is what lets the same parser read
  // a spreadsheet paste that has no description column at all.
  const gmt = defs.map(d => [d.id, '', ...d.genes].join('\t')).join('\n')
  const index = indexFor([parseSets(gmt, 'A')], bg)

  const { sets, universe } = prepareSets(defs)
  const bgSet = new Set()
  for (const g of bg) if (universe.has(g.toUpperCase())) bgSet.add(g.toUpperCase())
  const ref = runORA(new Set(query.map(g => g.toUpperCase())), sets, bgSet, { minSize: 1, maxSize: 100 })
  const idx = oraIndexed(query, index, { minSize: 1, maxSize: 100 })

  const key = r => [r.id, r.setSize, r.count, +r.pvalue.toFixed(12), +r.foldEnrichment.toFixed(12)].join('|')
  check('the same sets are reported', idx.length, ref.length)
  check('with the same numbers', idx.map(key).sort(), ref.map(key).sort())
  check('and every one has a real fold enrichment',
    idx.every(r => Number.isFinite(r.foldEnrichment) && r.foldEnrichment > 0), true)
}

console.log('\nTHE SPECIES A BUNDLE RECORDS')
{
  check('Mus musculus', speciesOfMeta('Mus musculus'), 'mouse')
  check('mouse (GRCm39)', speciesOfMeta('mouse (GRCm39)'), 'mouse')
  check('Homo sapiens', speciesOfMeta('Homo sapiens'), 'human')
  check('human, GRCh38', speciesOfMeta('human, GRCh38'), 'human')
  // Not guessed. A bundle that did not record it falls through to detection
  // from the gene names, which is a different and weaker kind of evidence.
  check('unknown is not an answer', speciesOfMeta('unknown'), null)
  check('nor is nothing', speciesOfMeta(undefined), null)
  check('nor is something unmappable', speciesOfMeta('Danio rerio'), null)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll ORA tests passed\n')
process.exit(failed ? 1 : 0)
