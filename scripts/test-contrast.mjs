// Which comparison the statistics describe, and what a bundle is allowed to say.
//
// The bugs this pins were all invisible on screen until they produced a wrong
// number somewhere else: a contrast naming groups no sample has, a group
// advertising more replicates than the matrix holds, a pair offered for a
// DESeq2 run that could never have enough replicates.

import { auditBundle, conditionSizes, defaultComparison, listComparisons } from '../src/lib/contrast.ts'

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
  // mismatch with samples.csv is the only evidence there is — and it is a real
  // defect worth reporting, unlike a declared interaction.
  const b = mk({
    conditions: ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'],
    control: 'Ctrl_Cold',
    contrasts: [
      { id: 'c1', numerator: 'KO:Cold', denominator: 'Ctrl:Cold', label: 'KO vs Ctrl (at Cold)' },
      { id: 'c2', numerator: 'KO:Thermo', denominator: 'Ctrl:Thermo', label: 'KO vs Ctrl (at Thermo)' },
    ],
  })
  const list = listComparisons(b)
  const c1 = list.find(c => c.id === 'c1')
  // The result is real and stays offered — it came out of the pipeline.
  check('the exported contrast is still listed', c1.source, 'bundle')
  // But it is flagged, so no view offers something it cannot deliver.
  check('and flagged as not tied to samples', c1.groupsAreConditions, false)
  check('with zero replicates found, honestly', [c1.nNumerator, c1.nDenominator], [0, 0])

  // The real conditions are still offered as computable pairs, so the reader
  // can get a per-sample comparison even though the pipeline's own is unusable.
  const real = list.find(c => c.numerator === 'KO_Cold' && c.denominator === 'Ctrl_Cold')
  check('the underlying pair is offered', real.source, 'computable')
  check('with its real replicate counts', [real.nNumerator, real.nDenominator], [6, 6])

  const audit = auditBundle(b)
  check('the audit names the problem', audit[0].kind, 'orphan-contrast')
  check('and quotes the offending groups',
    audit[0].text.includes('“Ctrl:Cold”') && audit[0].text.includes('“KO:Thermo”'), true)
}

console.log('\nAN INTERACTION IS NOT A MISNAMED PAIRWISE CONTRAST')
{
  // rnaseq-lab writes kind:'interaction' for the coefficient asking whether one
  // factor's effect depends on another. Its numerator is the coefficient name
  // and its denominator is the literal "interaction" — no sample has either,
  // BY CONSTRUCTION. Reading them as groups is what produced the reported
  // "needs at least 2 replicates per group (KO:Thermo: 0)".
  const b = mk({
    conditions: ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'],
    control: 'Ctrl_Cold',
    contrasts: [
      { id: 'p1', numerator: 'KO_Cold', denominator: 'Ctrl_Cold', label: 'KO vs Ctrl (at Cold)', kind: 'pairwise' },
      { id: 'ix', numerator: 'KO:Thermo', denominator: 'interaction', kind: 'interaction',
        label: 'Interaction: does the KO-vs-Ctrl effect differ between Thermo and Cold?' },
    ],
  })
  const list = listComparisons(b)
  const ix = list.find(c => c.id === 'ix')
  check('the interaction is recognised as one', ix.interaction, true)
  check('and has no groups, correctly', ix.groupsAreConditions, false)
  const pw = list.find(c => c.id === 'p1')
  check('the pairwise one is not', [pw.interaction, pw.groupsAreConditions], [false, true])

  // And the audit stays quiet: an interaction having no groups is not a defect,
  // and warning about it would train people to ignore the banner.
  check('the audit does not scold a correct bundle',
    auditBundle(b).some(p => p.kind === 'orphan-contrast'), false)
}

console.log('\nEVERY PAIR IS OFFERED ONCE, CONTROL FIRST')
{
  const b = mk({
    conditions: ['WT', 'KO', 'Rescue'],
    control: 'WT',
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT' }],
  })
  const list = listComparisons(b)
  // 3 conditions → 6 ordered pairs, one of which the pipeline exported.
  check('six comparisons in total', list.length, 6)
  check('the exported one comes first', [list[0].id, list[0].source], ['KO_vs_WT', 'bundle'])
  // The exported pair must not also appear as a computable duplicate.
  const kovswt = list.filter(c => c.numerator === 'KO' && c.denominator === 'WT')
  check('and is not duplicated', kovswt.length, 1)
  // Control-first ordering among the computed ones. Only one non-exported pair
  // has WT underneath (Rescue vs WT) because KO vs WT is the exported one, so
  // the property to assert is the GROUPING: every pair against the control,
  // then every pair against the next arm, never interleaved.
  const denoms = list.filter(c => c.source !== 'bundle').map(c => c.denominator)
  check('pairs are grouped by denominator, control first',
    denoms, ['WT', 'KO', 'KO', 'Rescue', 'Rescue'])
  check('all six are distinct pairs',
    new Set(list.map(c => `${c.numerator}|${c.denominator}`)).size, 6)
}

console.log('\nA PAIR THAT CANNOT BE RUN SAYS SO BEFORE IT IS TRIED')
{
  // One replicate in one arm. This used to be offered with a "Run DESeq2"
  // button that could only ever fail, and the failure arrived as a red line
  // after the click.
  const b = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 1 })
  const list = listComparisons(b)
  const c = list.find(x => x.numerator === 'KO')
  check('it is not offered as computable', c.source, 'unavailable')
  check('and says why, in advance', c.blocked.includes('at least 2 replicates'), true)

  // No raw counts is a different reason and gets a different sentence.
  const b2 = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 6, raw: false })
  const c2 = listComparisons(b2).find(x => x.numerator === 'KO')
  check('no raw counts is its own reason', c2.source, 'unavailable')
  check('and says that instead', c2.blocked.includes('raw_counts.csv'), true)
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
  check('and is offered in no comparison',
    listComparisons(b).some(c => c.numerator === 'Ghost' || c.denominator === 'Ghost'), false)

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
  check('and it opens on the exported contrast', defaultComparison(listComparisons(b)).id, 'KO_vs_WT')
}

console.log('\nOPENING WHEN THE PIPELINE EXPORTED NOTHING')
{
  const b = mk({ conditions: ['WT', 'KO'], control: 'WT', contrasts: [] })
  const d = defaultComparison(listComparisons(b))
  // Not null, and not an exported contrast that does not exist — the first pair
  // that could actually be run.
  check('falls through to a computable pair', d.source, 'computable')
  check('control on the bottom', [d.numerator, d.denominator], ['KO', 'WT'])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll contrast tests passed\n')
process.exit(failed ? 1 : 0)
