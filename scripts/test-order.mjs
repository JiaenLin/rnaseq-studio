// The figure order is a view of the bundle, and must not be able to become an
// edit of it.
//
// Ported from scrnaseq-studio's test-order.mjs along with the logic, and the
// risk it pins is the same one: every figure that splits by group reads
// `displayOrder(sel)`, so permuting one array moves all of them at once — and
// if anything downstream identified a group by its POSITION rather than its
// name, moving a level would move SAMPLES between groups. A figure, not an
// error. So most of what follows is not about the sort. It is about what the
// sort has to leave alone.

import { comparedGroups, defaultSelection, displayOrder, emptySel, orderSamples, samplesInGroups }
  from '../src/lib/design.ts'
import { moveItem, orderedBy } from '../src/lib/order.ts'
import { comparisonKey, relevantExclusions } from '../src/lib/contrast.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

console.log('\nORDEREDBY')
{
  const all = ['0h', '6h', '24h', '72h']
  check('no order is the bundle’s order', orderedBy(all, []), all)
  check('and is the SAME array, so nothing memoised on it rebuilds',
    orderedBy(all, []) === all, true)
  check('an order that agrees is also the same array', orderedBy(all, all) === all, true)
  check('a full order is followed',
    orderedBy(all, ['72h', '0h', '24h', '6h']), ['72h', '0h', '24h', '6h'])
  check('a partial order places what it names and keeps the rest as they were',
    orderedBy(all, ['72h']), ['72h', '0h', '6h', '24h'])
  check('a name this bundle does not have is ignored, not inserted',
    orderedBy(all, ['nonesuch', '24h']), ['24h', '0h', '6h', '72h'])
  check('every group survives, whatever the order says',
    orderedBy(all, ['24h', 'nonesuch']).slice().sort(), all.slice().sort())
  check('a repeated name does not duplicate the group',
    orderedBy(all, ['6h', '6h']), ['6h', '0h', '24h', '72h'])
}

console.log('\nA SELECTION FROM BEFORE THIS EXISTED')
{
  // `order` was added to a shape that already existed, so something can reach
  // here without it. Throwing on that blanks every figure that splits by group,
  // and it is not hypothetical: it took out the whole test suite the first time
  // this shipped, from one sel literal in another test file that predated the
  // field. The absence of an order means what an empty one means.
  const all = ['WT', 'KO', 'DKO']
  check('no order at all is the bundle’s order', orderedBy(all, undefined), all)
  check('and the same array, so nothing rebuilds', orderedBy(all, undefined) === all, true)
  const legacy = { control: ['WT'], test: ['KO'], extra: ['DKO'], excluded: [] }
  check('a selection with no order still draws every group',
    displayOrder(legacy), ['WT', 'KO', 'DKO'])
}

console.log('\nMOVEITEM')
{
  const l = ['a', 'b', 'c', 'd']
  check('later one', moveItem(l, 0, 1), ['b', 'a', 'c', 'd'])
  check('earlier one', moveItem(l, 3, 2), ['a', 'b', 'd', 'c'])
  check('to the far end', moveItem(l, 0, 3), ['b', 'c', 'd', 'a'])
  check('a move to itself is the same array', moveItem(l, 2, 2) === l, true)
  check('off either end is the same array', moveItem(l, 0, -1) === l, true)
  check('and past the end too', moveItem(l, 0, 4) === l, true)
}

console.log('\nWHAT THE FIGURES DRAW')
{
  const sel = {
    control: ['Ctrl_Cold'], test: ['KO_Cold'],
    extra: ['Ctrl_Thermo', 'KO_Thermo'], order: [], excluded: [],
  }
  check('by default: control, the compared arm, then the rest',
    displayOrder(sel), ['Ctrl_Cold', 'KO_Cold', 'Ctrl_Thermo', 'KO_Thermo'])
  // The thing that could not be asked for before: the two cold arms together
  // and the two thermoneutral ones together, whichever side each is on.
  check('the reader’s order wins',
    displayOrder({ ...sel, order: ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'] }),
    ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'])
  check('placing one group leaves the others where they were',
    displayOrder({ ...sel, order: ['KO_Thermo'] }),
    ['KO_Thermo', 'Ctrl_Cold', 'KO_Cold', 'Ctrl_Thermo'])
  // An order carried over from another bundle must degrade, not delete.
  check('an order from a different bundle never loses a group',
    displayOrder({ ...sel, order: ['A', 'B', 'KO_Thermo'] }).slice().sort(),
    ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo'])
  check('a group taken off both sides still draws', displayOrder(sel).length, 4)
  check('an empty selection draws nothing', displayOrder(emptySel()), [])
}

console.log('\nSAMPLES FOLLOW THE ORDER; NOTHING ELSE DOES')
{
  const conds = ['Ctrl_Cold', 'Ctrl_Thermo', 'KO_Cold', 'KO_Thermo']
  const samples = conds.flatMap(c => [1, 2].map(i => ({ sample: `${c}_${i}`, condition: c })))
  const cols = samples.map(s => s.sample)
  const sel = {
    control: ['Ctrl_Cold'], test: ['KO_Cold'],
    extra: ['Ctrl_Thermo', 'KO_Thermo'], order: [], excluded: [],
  }
  const reordered = { ...sel, order: ['KO_Thermo', 'Ctrl_Thermo', 'KO_Cold', 'Ctrl_Cold'] }

  const before = orderSamples(cols, samples, sel)
  const after = orderSamples(cols, samples, reordered)
  check('the axis follows the order', after.map(s => s.cond).filter((c, i, a) => c !== a[i - 1]),
    ['KO_Thermo', 'Ctrl_Thermo', 'KO_Cold', 'Ctrl_Cold'])

  // THE ONE THAT MATTERS. Every sample must still be in the group it was in:
  // reordering an axis that anything read by position would silently move
  // samples between groups, and the figure would look fine.
  // Compared as sorted PAIRS, not as objects: JSON.stringify of an object is
  // sensitive to key order, and key order here is axis order — the one thing
  // that is supposed to have changed. Comparing them as objects tests the
  // reorder against itself.
  const pairs = (rows, f) => rows.map(r => `${r.sample}=${f(r)}`).sort()
  check('and every sample is still in the group it was in',
    pairs(after, r => r.cond), pairs(before, r => r.cond))
  check('none is gained or lost', after.length, before.length)
  // `col` indexes the counts matrix; a sample paired with another's column is
  // the same defect one layer down, and would read another sample's expression.
  check('and still points at its own column in the matrix',
    pairs(after, r => r.col), pairs(before, r => r.col))

  check('which side a group is on does not move',
    comparedGroups(reordered), comparedGroups(sel))
  check('nor do the samples the comparison is run over',
    samplesInGroups(cols, samples, reordered.test, reordered.excluded),
    samplesInGroups(cols, samples, sel.test, sel.excluded))

  // A reorder must not invalidate a DESeq2 result or, worse, hit a different
  // cache entry: the key is built from the group names on each side and never
  // from this array.
  const bundle = { samples, counts: { samples: cols } }
  check('a computed result is not invalidated by a reorder',
    comparisonKey(bundle, reordered.control, reordered.test, reordered.excluded),
    comparisonKey(bundle, sel.control, sel.test, sel.excluded))
  check('nor are the exclusions that belong to it',
    relevantExclusions(bundle, reordered.control, reordered.test, ['Ctrl_Cold_1']),
    relevantExclusions(bundle, sel.control, sel.test, ['Ctrl_Cold_1']))
}

console.log('\nA FRESH SELECTION HAS NO ORDER OF ITS OWN')
{
  const meta = { control: 'WT', conditions: ['WT', 'KO', 'DKO'], contrasts: [] }
  check('defaultSelection starts on the bundle’s order', defaultSelection(meta).order, [])
  check('and emptySel too', emptySel().order, [])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll order tests passed\n')
process.exit(failed ? 1 : 0)
