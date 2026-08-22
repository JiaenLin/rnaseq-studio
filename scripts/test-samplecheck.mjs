// "Is this sample labelled correctly?" — against cases where the answer is known.
//
// The interesting property is not that it finds a swap; almost anything finds a
// swap when one is planted. It is that it does NOT fire on a design whose effect
// is small but real, because a check that flags a normal experiment is a check
// people switch off.

import { checkSamples } from '../src/lib/samplecheck.ts'

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
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}` + (ok ? '' : `\n        got ${got} want ${want}`))
}

/** Deterministic noise — a PCA that moves between runs is not a test. */
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

/**
 * A synthetic experiment: `nGroups` groups of `reps`, `nGenes` genes, where a
 * fraction of genes respond to the group with effect size `effect` (in log2).
 */
function makeExperiment({ nGroups = 2, reps = 4, nGenes = 600, effect = 2, responders = 0.2 }) {
  const m = nGroups * reps
  const names = [], groups = []
  for (let g = 0; g < nGroups; g++) {
    for (let r = 1; r <= reps; r++) { names.push(`G${g}_${r}`); groups.push(`G${g}`) }
  }
  const v = new Float64Array(nGenes * m)
  for (let i = 0; i < nGenes; i++) {
    const base = 20 + rnd() * 300
    const responds = rnd() < responders
    const lift = responds ? effect : 0
    for (let j = 0; j < m; j++) {
      const g = Math.floor(j / reps)
      v[i * m + j] = base * Math.pow(2, lift * g) * (0.85 + rnd() * 0.3)
    }
  }
  return { values: v, S: m, cols: Array.from({ length: m }, (_, i) => i), names, groups }
}

console.log('\nA CLEAN EXPERIMENT IS NOT FLAGGED')
{
  const e = makeExperiment({ nGroups: 3, reps: 4, effect: 2 })
  const r = checkSamples(e.values, e.S, e.cols, e.names, e.groups)
  check('every sample prefers its own group', r.verdicts.filter(v => v.misfit).map(v => v.sample), [])
  check('the diagonal is 1', r.matrix.map((row, i) => row[i]), r.samples.map(() => 1))
  check('the matrix is symmetric',
    r.matrix.every((row, i) => row.every((x, j) => Math.abs(x - r.matrix[j][i]) < 1e-12)), true)
  check('no correlation escapes [-1, 1]',
    r.matrix.flat().every(x => x >= -1 && x <= 1), true)
}

console.log('\nA WEAK BUT REAL EFFECT IS STILL NOT FLAGGED')
{
  // The case that matters for not crying wolf: groups that barely differ. Every
  // label is correct and the check must stay quiet, even though a clustering
  // would happily merge these groups.
  const e = makeExperiment({ nGroups: 2, reps: 6, effect: 0.35, responders: 0.15 })
  const r = checkSamples(e.values, e.S, e.cols, e.names, e.groups)
  check('nothing flagged on a subtle design', r.verdicts.filter(v => v.misfit).length, 0)
}

console.log('\nA SWAPPED PAIR OF LABELS IS FOUND')
{
  const e = makeExperiment({ nGroups: 2, reps: 5, effect: 2.5 })
  // Swap the labels of one sample from each group — the data is untouched, only
  // the labels move, which is exactly the failure being hunted.
  const groups = [...e.groups]
  groups[0] = 'G1'   // G0_1 now claims to be G1
  groups[5] = 'G0'   // G1_1 now claims to be G0
  const r = checkSamples(e.values, e.S, e.cols, e.names, groups)
  const flagged = r.verdicts.filter(v => v.misfit).map(v => v.sample).sort()
  check('both swapped samples are flagged', flagged, ['G0_1', 'G1_1'])
  const a = r.verdicts.find(v => v.sample === 'G0_1')
  check('and each is told which group it looks like', a.nearest, 'G0')
  check('with a positive margin', a.margin > 0, true)
}

console.log('\nONE MISLABELLED SAMPLE IS FOUND')
{
  const e = makeExperiment({ nGroups: 3, reps: 4, effect: 2.5 })
  const groups = [...e.groups]
  groups[0] = 'G2'   // a G0 sample claiming to be G2
  const r = checkSamples(e.values, e.S, e.cols, e.names, groups)
  const v = r.verdicts.find(x => x.sample === 'G0_1')
  check('it is flagged', v.misfit, true)
  check('and pointed at the right group', v.nearest, 'G0')
  // The point of the median: the impostor contaminates G2, and the four
  // genuine G2 samples must NOT be dragged into being reported with it.
  check('while nothing else is', r.verdicts.filter(x => x.misfit).length, 1)
}

console.log('\nA GROUP OF ONE CANNOT BE CHECKED, AND SAYS SO')
{
  const e = makeExperiment({ nGroups: 2, reps: 3, effect: 2 })
  const groups = [...e.groups]
  groups[0] = 'Solo'          // a group with exactly one member
  const r = checkSamples(e.values, e.S, e.cols, e.names, groups)
  check('the singleton is reported as such', r.singletons, ['Solo'])
  const v = r.verdicts.find(x => x.group === 'Solo')
  // It has no own-group to be unlike, so it is not a misfit — reporting it
  // would be reporting the design rather than a problem.
  check('and is not flagged', v.misfit, false)
  check('with no own-group score', Number.isNaN(v.own), true)
}

console.log('\nSELF IS NEVER COUNTED IN ITS OWN GROUP SCORE')
{
  // If a sample counted its own correlation of 1.0, every sample would prefer
  // its own group by construction and the check could never fire at all.
  const e = makeExperiment({ nGroups: 2, reps: 3, effect: 2 })
  const r = checkSamples(e.values, e.S, e.cols, e.names, e.groups)
  const v = r.verdicts[0]
  const idx = e.groups.map((g, i) => [g, i]).filter(([g, i]) => g === v.group && i !== 0).map(([, i]) => i)
  const rs = idx.map(j => r.matrix[0][j]).sort((a, b) => a - b)
  const byHand = rs.length % 2 ? rs[rs.length >> 1]
    : (rs[(rs.length >> 1) - 1] + rs[rs.length >> 1]) / 2
  near('own score is the median over the OTHERS', v.own, byHand, 1e-12)
  check('and is below 1', v.own < 1, true)
}

console.log('\nNO GROUP STRUCTURE IS REPORTED AS THAT, NOT AS 18 BAD SAMPLES')
{
  // Groups that do not separate at all. Every label is correct; there is simply
  // no effect. Judging margins against zero flagged most of the experiment here
  // — true, meaningless, and indistinguishable from a real finding.
  const e = makeExperiment({ nGroups: 4, reps: 6, effect: 0, responders: 0 })
  const r = checkSamples(e.values, e.S, e.cols, e.names, e.groups)
  check('the weakness is the finding', r.weakStructure, true)
  check('and no sample is accused', r.verdicts.filter(v => v.misfit).length, 0)
  check('with the separation reported', r.separation < 0.02, true)
}

console.log('\nA MARGIN IS JUDGED AGAINST THE DESIGN, NOT AGAINST ZERO')
{
  const e = makeExperiment({ nGroups: 3, reps: 5, effect: 2.5 })
  const r = checkSamples(e.values, e.S, e.cols, e.names, e.groups)
  check('a separated design is not called weak', r.weakStructure, false)
  check('and is still clean', r.verdicts.filter(v => v.misfit).length, 0)
  // A sample may still edge toward a neighbour by a hair — that is normal
  // variation, and the whole point of the threshold is that it does not become
  // an accusation. What must hold is that no such margin comes close to the
  // separation between the groups themselves.
  const worst = Math.max(...r.verdicts.map(v => v.margin))
  check('the worst margin is far below the design separation',
    worst < r.separation * 0.5, true)
}

console.log('\nDEGENERATE INPUT')
{
  const one = checkSamples(new Float64Array([1, 2, 3]), 1, [0], ['A'], ['G'])
  check('a single sample yields nothing', one.verdicts, [])
  const flat = checkSamples(new Float64Array([5, 5, 5, 5]), 2, [0, 1], ['A', 'B'], ['G', 'G'])
  check('a matrix with no variance yields nothing', flat.nGenes, 0)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll sample-check tests passed\n')
process.exit(failed ? 1 : 0)
