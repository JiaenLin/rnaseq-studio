// Which comparison the statistics describe, and what a bundle is allowed to say.
//
// The bugs this pins were all invisible on screen until they produced a wrong
// number somewhere else: a contrast naming groups no sample has, a group
// advertising more replicates than the matrix holds, a pair offered for a
// DESeq2 run that could never have enough replicates.

import { auditBundle, comparisonKey, comparisonState, conditionSizes, matchPrecomputed, relevantExclusions }
  from '../src/lib/contrast.ts'

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

console.log('\nA RESULT IS CACHED UNDER THE SAMPLES IT WAS COMPUTED FROM')
{
  const b = mk({ conditions: ['WT', 'KO'], control: 'WT', reps: 6 })
  const k0 = comparisonKey(b, ['WT'], ['KO'], [])
  const k1 = comparisonKey(b, ['WT'], ['KO'], ['KO_1'])
  const k2 = comparisonKey(b, ['WT'], ['KO'], ['KO_2'])
  // The bug this pins: the key was the two group lists and nothing else, so a
  // run with KO_1 excluded and a run with KO_2 excluded collided — the app
  // served the first one's numbers under the second one's label.
  check('excluding a sample changes the key', k0 === k1, false)
  check('and excluding a DIFFERENT one is different again', k1 === k2, false)
  check('the same exclusion in another order is the same key',
    comparisonKey(b, ['WT'], ['KO'], ['KO_1', 'KO_2']),
    comparisonKey(b, ['WT'], ['KO'], ['KO_2', 'KO_1']))

  // An exclusion outside the compared groups changes nothing, so it must NOT
  // invalidate the cache — otherwise toggling an unrelated sample throws away
  // a valid run.
  const b3 = mk({ conditions: ['WT', 'KO', 'Other'], control: 'WT', reps: 6 })
  check('an unrelated exclusion keeps the key',
    comparisonKey(b3, ['WT'], ['KO'], ['Other_1']),
    comparisonKey(b3, ['WT'], ['KO'], []))
  check('and is reported as irrelevant',
    relevantExclusions(b3, ['WT'], ['KO'], ['Other_1', 'KO_3']), ['KO_3'])

  // A cached run is found only under its own key.
  check('the run is found again', comparisonState(b, ['WT'], ['KO'], ['KO_1'], { [k1]: [] }).source, 'computed')
  check('and not under a different exclusion',
    comparisonState(b, ['WT'], ['KO'], ['KO_2'], { [k1]: [] }).source, 'computable')
}

console.log('\nA PIPELINE TABLE THAT CANNOT HONOUR AN EXCLUSION IS WITHHELD')
{
  const b = mk({
    conditions: ['WT', 'KO'], control: 'WT', reps: 6,
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT', kind: 'pairwise' }],
  })
  const clean = comparisonState(b, ['WT'], ['KO'], [], {})
  check('with nothing excluded it is simply the bundle table', clean.source, 'bundle')
  check('and nothing is stale', clean.staleExclusions, [])

  const st = comparisonState(b, ['WT'], ['KO'], ['KO_1'], {})
  // The pipeline's table is WITHHELD, not annotated. It was computed over
  // samples the reader has taken out, so it does not describe this selection —
  // and a warning printed beside a DEG table does not travel with a screenshot
  // of it.
  check('the table is not used', st.source, 'computable')
  check('and no contrast is handed to the tabs', st.contrast, null)
  // Carried, so the bar can name what it is declining to show rather than
  // leaving the tabs mysteriously empty.
  check('the withheld table is named', st.hiddenPrecomputed?.id, 'KO_vs_WT')
  check('with the samples that caused it', st.staleExclusions, ['KO_1'])
  check('and a re-run is possible', st.canRun, true)

  // Bring the sample back and the pipeline's result returns untouched.
  check('clearing the exclusion restores it',
    comparisonState(b, ['WT'], ['KO'], [], {}).source, 'bundle')
  // An exclusion outside the pair does not withhold anything.
  const b3 = mk({
    conditions: ['WT', 'KO', 'Other'], control: 'WT', reps: 6,
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT', kind: 'pairwise' }],
  })
  check('an unrelated exclusion leaves it alone',
    comparisonState(b3, ['WT'], ['KO'], ['Other_1'], {}).source, 'bundle')

  // No raw counts: the table is still withheld — it is still wrong for this
  // selection — but the re-run cannot be offered, so the way back is stated.
  const b2 = mk({
    conditions: ['WT', 'KO'], control: 'WT', reps: 6, raw: false,
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT', kind: 'pairwise' }],
  })
  const noRaw = comparisonState(b2, ['WT'], ['KO'], ['KO_1'], {})
  check('without raw counts it is still withheld', noRaw.source, 'unavailable')
  check('and there is no re-run', noRaw.canRun, false)
  check('but the way back is named', noRaw.blocked.includes('Bring them back'), true)
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
  // And exclusions come off the top, because these numbers are printed on the
  // group chips beside a summary line that already subtracts them.
  check('exclusions come off the chip counts',
    [...conditionSizes(b, ['KO_1', 'WT_1']).entries()].sort(), [['KO', 3], ['WT', 5]])
  // Pre-seeding every declared condition with 0 here would make auditBundle's
  // `sizes.has(c)` true for a condition no sample carries, retiring that
  // warning silently. Pinned so the shortcut is not taken later.
  const ghosty = mk({ conditions: ['WT', 'KO', 'Ghost'], control: 'WT' })
  ghosty.samples = ghosty.samples.filter(x => x.condition !== 'Ghost')
  ghosty.counts.samples = ghosty.samples.map(x => x.sample)
  check('a condition with no samples is absent, not zero',
    conditionSizes(ghosty).has('Ghost'), false)
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
