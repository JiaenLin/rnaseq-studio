// Regression tests for bundle parsing (npm test, and in CI before deploy).
// Runs the real src/lib/bundle.ts via Node's built-in TypeScript type-stripping.
//
// These exist because of a silent data-loss bug: PapaParse's dynamicTyping read
// a condition named "517E2" as scientific notation (51700), so it no longer
// matched meta.conditions and those samples vanished from every plot without
// any error. Identifiers must stay text; only numeric columns get coerced.
import { assemble } from '../src/lib/bundle.ts'
import {
  contrastMismatch, defaultSelection, displayOrder, matchingContrast, orderSamples,
} from '../src/lib/design.ts'

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
  check('default reference is the contrast denominator', def.control, '517E2')
  check('default shows every other group', def.groups.length, CONDITIONS.length - 1)
  check('control is drawn first', displayOrder(def)[0], '517E2')
  check('control never repeats in the group list', displayOrder(def).filter(c => c === '517E2').length, 1)

  const narrow = { control: '517E2', groups: ['517E2+RSL3'] }
  const shown = orderSamples(bundle.counts.samples, bundle.samples, narrow)
  check('narrowing drops unselected samples', shown.length, 4)      // 2 groups x 2 reps
  check('samples come back control-first',
    [...new Set(shown.map(s => s.cond))], ['517E2', '517E2+RSL3'])
  check('every returned col indexes the counts matrix',
    shown.every(s => s.col >= 0 && s.col < bundle.counts.samples.length), true)

  check('one experimental group resolves to its contrast',
    matchingContrast(narrow, meta.contrasts)?.id, '517E2+RSL3_vs_517E2')
  check('several groups resolve to no single contrast',
    matchingContrast({ control: '517E2', groups: ['517E2+RSL3', '0755'] }, meta.contrasts), undefined)
  check('a mismatched reference is reported',
    contrastMismatch({ control: '0755', groups: ['517E2+RSL3'] }, meta.contrasts[0]), true)
  check('a matching selection is not reported as mismatched',
    contrastMismatch(narrow, meta.contrasts[0]), false)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll bundle tests passed\n')
process.exit(failed ? 1 : 0)
