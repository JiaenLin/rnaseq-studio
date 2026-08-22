// Which comparison the statistics describe, and what a bundle is allowed to say.
//
// The bugs this pins were all invisible on screen until they produced a wrong
// number somewhere else: a contrast naming groups no sample has, a group
// advertising more replicates than the matrix holds, a pair offered for a
// DESeq2 run that could never have enough replicates.

import { auditBundle, comparisonState, conditionSizes, matchPrecomputed } from '../src/lib/contrast.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

/** A bundle just complete enough for these functions. */
function mk({ conditions, control = conditions[0], contrasts = [], reps = 6, raw = true,
  matrixDrops = [], deg = null, extraSamples = [] }) {
  const samples = []
  for (const c of conditions) for (let i = 1; i <= reps; i++) samples.push({ sample: `${c}_${i}`, condition: c })
  samples.push(...extraSamples)
  const cols = samples.map(s => s.sample).filter(s => !matrixDrops.includes(s))
  const degByContrast = deg ?? Object.fromEntries(contrasts.map(c => [c.id, [{ gene_id: 'G1' }]]))
  return {
    meta: { conditions, control, contrasts },
    samples,
    counts: { samples: cols, geneIds: ['G1'], geneNames: [''], values: new Float64Array(cols.length), index: new Map() },
    rawCounts: raw ? {} : undefined,
    degByContrast,
    enrichmentByContrast: {},
  }
}

console.log('\nTHE SCREENSHOT, AS A TEST')
{
  // A schema-v1 bundle with no `kind` at all, whose pipeline named its
  // contrasts after model coefficients. Nothing declares what these are, so the
  // mismatch with samples.csv is the only evidence there is.
  const b = mk({
    conditions: ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'],
    control: 'Ctrl_Cold',
    contrasts: [
      { id: 'c1', numerator: 'KO:Cold', denominator: 'Ctrl:Cold', label: 'KO vs Ctrl (at Cold)' },
      { id: 'c2', numerator: 'KO:Thermo', denominator: 'Ctrl:Thermo', label: 'KO vs Ctrl (at Thermo)' },
    ],
  })
  // Its groups are not conditions, so no selection the reader can make matches
  // it — and the pair they WOULD select is offered as a run instead.
  check('no selection matches a coefficient-named contrast',
    matchPrecomputed(b, ['Ctrl_Cold'], ['KO_Cold']), null)
  const st = comparisonState(b, ['Ctrl_Cold'], ['KO_Cold'], [], {})
  check('so the real pair is computable', st.source, 'computable')
  check('with its real replicate counts', [st.nTest, st.nControl], [6, 6])

  const audit = auditBundle(b)
  check('the audit names the problem', audit[0].kind, 'orphan-contrast')
  check('and quotes the offending groups',
    audit[0].text.includes('“Ctrl:Cold”') && audit[0].text.includes('“KO:Thermo”'), true)
}

console.log('\nAN INTERACTION IS NOT A MISNAMED PAIRWISE CONTRAST')
{
  const b = mk({
    conditions: ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'],
    control: 'Ctrl_Cold',
    contrasts: [
      { id: 'p1', numerator: 'KO_Cold', denominator: 'Ctrl_Cold', label: 'KO vs Ctrl (at Cold)', kind: 'pairwise' },
      { id: 'ix', numerator: 'KO:Thermo', denominator: 'interaction', kind: 'interaction',
        label: 'Interaction: does the KO-vs-Ctrl effect differ between Thermo and Cold?' },
    ],
  })
  check('the pairwise one is found by its pair', matchPrecomputed(b, ['Ctrl_Cold'], ['KO_Cold'])?.id, 'p1')
  // An interaction can never be reached by picking two groups, which is right:
  // it is not a comparison between two groups.
  check('the interaction is never matched',
    b.meta.contrasts.some(c => matchPrecomputed(b, [c.denominator], [c.numerator])?.kind === 'interaction'), false)
  check('and the audit stays quiet about it',
    auditBundle(b).some(p => p.kind === 'orphan-contrast'), false)
}

console.log('\nPRECOMPUTED IS A PROPERTY OF THE ANSWER, NOT A MENU')
{
  const b = mk({
    conditions: ['WT', 'KO', 'Rescue'],
    control: 'WT',
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT' }],
  })
  check('the exported pair reports as such',
    comparisonState(b, ['WT'], ['KO'], [], {}).source, 'bundle')
  // The pair the pipeline never exported is reachable all the same. That is the
  // whole point: the exporter's choices no longer decide what can be asked.
  check('an unexported pair is computable',
    comparisonState(b, ['WT'], ['Rescue'], [], {}).source, 'computable')
  check('and so is the reverse of an exported one',
    comparisonState(b, ['KO'], ['WT'], [], {}).source, 'computable')
  // Pooling: two groups against one is never precomputed, always a run.
  check('a pooled side is never a bundle table',
    comparisonState(b, ['WT'], ['KO', 'Rescue'], [], {}).source, 'computable')
  check('and pools the replicate count', comparisonState(b, ['WT'], ['KO', 'Rescue'], [], {}).nTest, 12)
  check('a session run is reported as run here',
    comparisonState(b, ['WT'], ['Rescue'], [], { 'Rescue|WT': [] }).source, 'computed')
}

console.log('\nWHAT CANNOT BE ASKED, AND WHY')
{
  const b = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 1 })
  check('too few replicates says so in advance',
    comparisonState(b, ['WT'], ['KO'], [], {}).blocked.includes('at least 2'), true)
  const b2 = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 6, raw: false })
  check('no raw counts is its own reason',
    comparisonState(b2, ['WT'], ['KO'], [], {}).blocked.includes('raw_counts.csv'), true)
  const b3 = mk({ conditions: ['WT', 'KO'], control: 'WT' })
  check('a group on both sides is not a comparison',
    comparisonState(b3, ['WT'], ['WT'], [], {}).blocked.includes('both sides'), true)
  check('an empty side says so',
    comparisonState(b3, ['WT'], [], [], {}).blocked.includes('each side'), true)
}

console.log('\nEXCLUSIONS REACH THE REPLICATE COUNTS')
{
  const b = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 6 })
  const st = comparisonState(b, ['WT'], ['KO'], ['KO_1', 'KO_2'], {})
  check('an excluded sample is not counted', st.nTest, 4)
  check('the other side is untouched', st.nControl, 6)
  // Down to one usable replicate, the run is refused before it is offered.
  const thin = comparisonState(b, ['WT'], ['KO'], ['KO_1', 'KO_2', 'KO_3', 'KO_4', 'KO_5'], {})
  check('exclusions can make a pair unrunnable', thin.source, 'unavailable')
}

console.log('\nREPLICATES ARE COUNTED FROM THE MATRIX, NOT THE SHEET')
{
  // A sample dropped at QC is removed from the counts and left in samples.csv.
  // The bar used to count the sheet, so a group advertised 6 and drew 4.
  const b = mk({
    conditions: ['WT', 'KO'], control: 'WT', reps: 6,
    matrixDrops: ['KO_5', 'KO_6'],
  })
  check('the matrix decides', [...conditionSizes(b).entries()].sort(), [['KO', 4], ['WT', 6]])
  const audit = auditBundle(b)
  check('and the discrepancy is reported', audit.some(p => p.kind === 'missing-samples'), true)
  check('naming how many', audit.find(p => p.kind === 'missing-samples').text.includes('2 samples'), true)
}

console.log('\nCONDITIONS THAT DO NOT LINE UP')
{
  const b = mk({ conditions: ['WT', 'KO', 'Ghost'], control: 'WT' })
  // "Ghost" is declared but has no samples, because mk only makes samples for
  // conditions it is given — so remove them.
  b.samples = b.samples.filter(s => s.condition !== 'Ghost')
  b.counts.samples = b.samples.map(s => s.sample)
  const audit = auditBundle(b)
  check('a declared condition with no samples is reported',
    audit.some(p => p.kind === 'orphan-condition' && p.text.includes('“Ghost”')), true)
  // And it is not offered as a comparison, because nothing could be drawn.
  // A condition with no samples has no side to be on: selecting it yields a
  // comparison with nothing in it, which is refused rather than drawn empty.
  check('selecting it yields nothing to compare',
    comparisonState(b, ['WT'], ['Ghost'], [], {}).nTest, 0)

  // The other direction: a condition in the sheet that meta.json forgot.
  const b2 = mk({ conditions: ['WT', 'KO'], control: 'WT' })
  b2.samples.push({ sample: 'X1', condition: 'Undeclared' })
  b2.counts.samples.push('X1')
  check('an undeclared condition is reported too',
    auditBundle(b2).some(p => p.text.includes('meta.json does not list')), true)
}

console.log('\nA CONTRAST WITH NO RESULTS TABLE')
{
  const b = mk({
    conditions: ['WT', 'KO'], control: 'WT',
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT' }],
    deg: {},          // deg_KO_vs_WT.csv missing or unreadable
  })
  check('it is reported rather than drawn empty',
    auditBundle(b).some(p => p.kind === 'empty-contrast'), true)
}

console.log('\nA CLEAN BUNDLE IS SILENT')
{
  const b = mk({
    conditions: ['WT', 'KO'], control: 'WT',
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT' }],
  })
  check('nothing to report', auditBundle(b), [])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll contrast tests passed\n')
process.exit(failed ? 1 : 0)
