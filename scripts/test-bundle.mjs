// Regression tests for bundle parsing (npm test, and in CI before deploy).
// Runs the real src/lib/bundle.ts via Node's built-in TypeScript type-stripping.
//
// These exist because of a silent data-loss bug: PapaParse's dynamicTyping read
// a condition named "517E2" as scientific notation (51700), so it no longer
// matched meta.conditions and those samples vanished from every plot without
// any error. Identifiers must stay text; only numeric columns get coerced.
import { assemble } from '../src/lib/bundle.ts'
import { defaultSelection, displayOrder, orderSamples, samplesInGroups } from '../src/lib/design.ts'
import { computedContrastId, countSignificant, isComputedContrast } from '../src/lib/deseq.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

// A design whose labels are all number-shaped in some way.
const CONDITIONS = ['517E2', '51701', '517E2+RSL3', '0755', '1E5']
const files = {
  'meta.json': JSON.stringify({
    schema: 1, project: 'p', species: 'human', created: '2026-01-01',
    engine: 'desktop-R', control: '517E2', conditions: CONDITIONS,
    gene_id_type: 'symbol', counts_unit: 'DESeq2 normalized (median-of-ratios)',
    contrasts: [{
      id: '517E2+RSL3_vs_517E2', numerator: '517E2+RSL3', denominator: '517E2',
      label: '517E2+RSL3 vs 517E2', deg_file: 'deg_517E2+RSL3_vs_517E2.csv',
      enrichment_file: 'enr.csv',
    }],
  }),
  'samples.csv': 'sample,condition\n' +
    CONDITIONS.flatMap(c => [1, 2].map(r => `${c}_r${r},${c}`)).join('\n') + '\n',
  'normalized_counts.csv': 'gene_id,gene_name,' +
    CONDITIONS.flatMap(c => [1, 2].map(r => `${c}_r${r}`)).join(',') + '\n' +
    '1E5,1E5,' + CONDITIONS.flatMap(() => [10, 20]).join(',') + '\n' +
    'GPX4,GPX4,' + CONDITIONS.flatMap(() => [30, 40]).join(',') + '\n',
  'deg_517E2+RSL3_vs_517E2.csv':
    'gene_id,gene_name,baseMean,log2FoldChange,lfcSE,pvalue,padj\n' +
    '1E5,1E5,100,1.5,0.2,1e-6,1e-4\n' +
    'GPX4,GPX4,50,NA,NA,NA,NA\n',
  'enr.csv': 'source,method,id,description,direction,setSize,count,score,pvalue,padj\n' +
    'Hallmark,ORA,H1,SET_ONE,both,25,7,3.2,1e-5,1e-3\n',
}
const bundle = await assemble(async n => files[n] ?? null)

console.log('\nIDENTIFIERS MUST SURVIVE AS TEXT')
check('"517E2" is not read as 51700',
  bundle.samples.filter(s => s.condition === '517E2').length, 2)
check('every declared condition is present in samples.csv',
  CONDITIONS.filter(c => !bundle.samples.some(s => s.condition === c)), [])
check('"0755" keeps its leading zero',
  bundle.samples.some(s => s.condition === '0755'), true)
check('"1E5" condition stays text',
  bundle.samples.some(s => s.condition === '1E5'), true)
check('a gene id shaped like a number stays text',
  bundle.counts.index.has('1E5'), true)
check('"+" in a contrast id resolves its deg file',
  (bundle.degByContrast['517E2+RSL3_vs_517E2'] ?? []).length, 2)

console.log('\nNUMERIC COLUMNS MUST STILL BE NUMBERS')
const deg = bundle.degByContrast['517E2+RSL3_vs_517E2']
check('log2FoldChange is a number', typeof deg[0].log2FoldChange, 'number')
check('padj is a number', typeof deg[0].padj, 'number')
check('baseMean is a number', typeof deg[0].baseMean, 'number')
check('R\'s "NA" becomes null, not the string "NA"', deg[1].padj, null)
check('NA log2FoldChange becomes null', deg[1].log2FoldChange, null)
const enr = bundle.enrichmentByContrast['517E2+RSL3_vs_517E2']
check('enrichment count is a number', typeof enr[0].count, 'number')
check('enrichment padj is a number', typeof enr[0].padj, 'number')
check('enrichment description stays text', enr[0].description, 'SET_ONE')

console.log('\nCOUNTS MATRIX')
check('counts parsed for every sample', bundle.counts.samples.length, CONDITIONS.length * 2)
check('gene lookup by symbol works', bundle.counts.index.get('GPX4'), 1)

console.log('\nGROUP SELECTION')
{
  const meta = bundle.meta
  const def = defaultSelection(meta, meta.contrasts[0])
  // Both sides are lists now: either may hold several groups, which is how a
  // pooled main effect is asked for on a factorial design.
  check('default reference is the contrast denominator', def.control, ['517E2'])
  check('default compares the contrast numerator', def.test, [meta.contrasts[0].numerator])
  check('every other group is still drawn',
    displayOrder(def).length, CONDITIONS.length)
  check('control is drawn first', displayOrder(def)[0], '517E2')
  check('no group is drawn twice',
    new Set(displayOrder(def)).size, displayOrder(def).length)

  const narrow = { control: ['517E2'], test: ['517E2+RSL3'], extra: [], excluded: [] }
  const shown = orderSamples(bundle.counts.samples, bundle.samples, narrow)
  check('narrowing drops unselected samples', shown.length, 4)      // 2 groups x 2 reps
  check('samples come back control-first',
    [...new Set(shown.map(s => s.cond))], ['517E2', '517E2+RSL3'])
  check('every returned col indexes the counts matrix',
    shown.every(s => s.col >= 0 && s.col < bundle.counts.samples.length), true)

  // An excluded sample is gone from every per-sample view, which all resolve
  // their samples through orderSamples.
  const dropped = shown[0].sample
  const minusOne = orderSamples(bundle.counts.samples, bundle.samples,
    { ...narrow, excluded: [dropped] })
  check('an excluded sample is dropped', minusOne.length, shown.length - 1)
  check('and it is the right one', minusOne.some(s => s.sample === dropped), false)

  // Pooling both sides: the samples of two groups, as one side.
  const pooled = samplesInGroups(bundle.counts.samples, bundle.samples,
    ['517E2', '517E2+RSL3'], [])
  check('a pooled side gathers both groups', pooled.length, 4)
  check('and honours exclusions',
    samplesInGroups(bundle.counts.samples, bundle.samples,
      ['517E2', '517E2+RSL3'], [pooled[0]]).length, 3)
}

console.log('\nDESeq2 CONTRAST HELPERS')
{
  check('computed contrast ids are marked',
    isComputedContrast(computedContrastId(['a'], ['b'])), true)
  check('pipeline contrast ids are not', isComputedContrast('a_vs_b'), false)
  check('the id carries both group names',
    computedContrastId(['517E2+RSL3'], ['517E2']), '~deseq2:517E2+RSL3_vs_517E2')

  const rows = [
    { gene_id: 'A', gene_name: 'A', baseMean: 10, log2FoldChange: 2.5, lfcSE: null, pvalue: 1e-6, padj: 1e-4 },
    { gene_id: 'B', gene_name: 'B', baseMean: 10, log2FoldChange: 0.2, lfcSE: null, pvalue: 0.5, padj: 0.8 },
    { gene_id: 'C', gene_name: 'C', baseMean: 10, log2FoldChange: -3.0, lfcSE: null, pvalue: 1e-8, padj: 1e-6 },
    { gene_id: 'D', gene_name: 'D', baseMean: 10, log2FoldChange: 4.0, lfcSE: null, pvalue: null, padj: null },
  ]
  check('significant genes are counted in both directions', countSignificant(rows), 2)
  check('a large fold change with no padj does not count',
    countSignificant([rows[3]]), 0)
  check('thresholds are respected', countSignificant(rows, 1e-5, 1), 1)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll bundle tests passed\n')
process.exit(failed ? 1 : 0)
