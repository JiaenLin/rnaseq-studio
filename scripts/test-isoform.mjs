// Regression tests for the long-read (isoform) layer.
//
// The layer is ADDITIVE: a schema-1 bundle must open with none of it, and a
// schema-2 bundle must not disturb anything the gene layer does. Both are
// checked here, because "it still works for short reads" is the property most
// easily broken by a change nobody thought applied to it.
import { assemble } from '../src/lib/bundle.ts'
import { isoformGenes, isoformsOfGene, categoryTally } from '../src/lib/isoform.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const reader = files => async name => (name in files ? files[name] : null)

const GENE_ONLY = {
  'meta.json': JSON.stringify({
    schema: 1, project: 'p', species: 'mouse', created: '2026-01-01', engine: 'e',
    control: 'WT', conditions: ['WT', 'KO'], gene_id_type: 'ensembl', counts_unit: 'x',
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT', deg_file: 'deg_KO_vs_WT.csv' }],
  }),
  'samples.csv': 'sample,condition\nS1,WT\nS2,WT\nS3,KO\nS4,KO\n',
  'normalized_counts.csv': 'gene_id,gene_name,S1,S2,S3,S4\nG1,Gx,10,12,40,44\nG2,Gy,7,7,7,7\n',
  'deg_KO_vs_WT.csv': 'gene_id,gene_name,baseMean,log2FoldChange,lfcSE,pvalue,padj\nG1,Gx,20,2,0.3,1e-9,1e-7\nG2,Gy,7,0.01,0.3,0.9,0.99\n',
}

// Same bundle plus a transcript layer. G1's total is flat by construction; its
// isoform mix inverts. That is a switch and nothing else in the app can show it.
const LONG = {
  ...GENE_ONLY,
  'meta.json': JSON.stringify({
    schema: 2, project: 'p', species: 'mouse', created: '2026-01-01', engine: 'e',
    control: 'WT', conditions: ['WT', 'KO'], gene_id_type: 'ensembl', counts_unit: 'x',
    platform: 'long-read',
    transcript_layer: {
      annotation: 'transcripts.csv', counts: 'transcript_counts.csv',
      n_transcripts: 3, n_novel: 1,
      dte_files: { KO_vs_WT: 'dte_KO_vs_WT.csv' },
      dtu_files: { KO_vs_WT: 'dtu_KO_vs_WT.csv' },
      dtu_engine: 'DEXSeq', category_vocabulary: 'sqanti',
    },
    longread_qc: [{ sample: 'S1', total_reads: 100, mt_pct: 84.7, unmapped_pct: 39 }],
    contrasts: [{ id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT', deg_file: 'deg_KO_vs_WT.csv' }],
  }),
  'transcripts.csv':
    'transcript_id,gene_id,gene_name,transcript_name,display_name,structural_category,novel\n' +
    'T1,G1,Gx,Gx-201,Gx-201,full-splice_match,FALSE\n' +
    'T2,G1,Gx,Gx-202,Gx-202,full-splice_match,FALSE\n' +
    'T3,G2,Gy,,Gy-novel-1,novel_in_catalog,TRUE\n',
  'transcript_counts.csv': 'transcript_id,S1,S2,S3,S4\nT1,9,10,1,2\nT2,1,2,39,42\nT3,7,7,7,7\n',
  'dte_KO_vs_WT.csv': 'transcript_id,baseMean,log2FoldChange,lfcSE,pvalue,padj\nT1,5,-3.1,0.4,1e-8,1e-6\nT2,20,4.2,0.4,1e-9,1e-7\nT3,7,0,0.3,0.9,0.99\n',
  // G1: usage flips, gene total flat (padj 1e-7 on G1 is a CHANGED gene, so it
  // is NOT a switch). G2: usage moves, gene flat -> the switch.
  'dtu_KO_vs_WT.csv':
    'transcript_id,gene_id,usage_effect,pvalue,padj,gene_padj,mean_usage_num,mean_usage_den\n' +
    'T1,G1,-3.2,1e-9,1e-8,1e-8,0.07,0.90\n' +
    'T2,G1,3.2,1e-9,1e-8,1e-8,0.93,0.10\n' +
    'T3,G2,1.1,1e-4,1e-3,1e-3,0.80,0.40\n',
}

console.log('\nA SCHEMA-1 BUNDLE IS UNTOUCHED')
{
  const b = await assemble(reader(GENE_ONLY))
  check('no transcripts', b.transcripts, undefined)
  check('no transcript counts', b.transcriptCounts, undefined)
  check('no DTU', b.dtuByContrast, undefined)
  check('no DTE', b.dteByContrast, undefined)
  check('the gene layer still loads', b.degByContrast.KO_vs_WT.length, 2)
  check('and the isoform maths answers nothing rather than throwing',
    isoformGenes(b, 'KO_vs_WT'), [])
}

console.log('\nA SCHEMA-2 BUNDLE CARRIES BOTH LAYERS')
const b = await assemble(reader(LONG))
check('gene layer unchanged', b.degByContrast.KO_vs_WT.length, 2)
check('transcripts read', b.transcripts.length, 3)
check('display names, not accessions', b.transcripts.map(t => t.display_name),
  ['Gx-201', 'Gx-202', 'Gy-novel-1'])
check('novel flag parsed', b.transcripts.map(t => t.novel), [false, false, true])
check('transcript counts keyed by transcript id',
  b.transcriptCounts.geneIds, ['T1', 'T2', 'T3'])
check('DTE table is keyed by transcript, in the DEG shape',
  b.dteByContrast.KO_vs_WT.map(r => r.gene_id), ['T1', 'T2', 'T3'])
check('DTU parsed', b.dtuByContrast.KO_vs_WT.length, 3)
check('QC carried through', b.meta.longread_qc[0].mt_pct, 84.7)

console.log('\nSWITCHES ARE THE INTERSECTION, NOT THE UNION')
check('every gene with moved usage', isoformGenes(b, 'KO_vs_WT').map(g => g.gene_id),
  ['G1', 'G2'])
// G1's gene padj is 1e-7 (changed), so it is not a switch however dramatic its
// usage shift. G2's is 0.99.
check('a switch is usage moved AND gene total not',
  isoformGenes(b, 'KO_vs_WT', { switchOnly: true }).map(g => g.gene_id), ['G2'])
{
  // A gene the DEG table never tested must not be called "unchanged".
  const noDeg = { ...LONG, 'deg_KO_vs_WT.csv': 'gene_id,gene_name,baseMean,log2FoldChange,lfcSE,pvalue,padj\nG1,Gx,20,2,0.3,1e-9,1e-7\n' }
  const b2 = await assemble(reader(noDeg))
  check('an untested gene is not counted as a switch',
    isoformGenes(b2, 'KO_vs_WT', { switchOnly: true }).map(g => g.gene_id), [])
}

console.log('\nONE GENE')
{
  const rows = isoformsOfGene(b, 'KO_vs_WT', 'G1')
  check('both isoforms, dominant-in-reference first', rows.map(r => r.tx.display_name),
    ['Gx-201', 'Gx-202'])
  check('shares come from the engine, not recomputed',
    rows.map(r => r.row.mean_usage_den), [0.9, 0.1])
  check('and the level fold change is a separate number',
    rows.map(r => r.dte.log2FoldChange), [-3.1, 4.2])
}
check('category tally', categoryTally(b.transcripts),
  [{ name: 'full-splice_match', n: 2 }, { name: 'novel_in_catalog', n: 1 }])

console.log('\nTHE PRE-satuRn COLUMN NAME STILL READS')
{
  // Bundles written while the engine was DEXSeq carry `usage_log2FC`. They must
  // keep opening: the column was renamed because satuRn's effect is log-odds and
  // not a fold change, which is a labelling fix, not a data change.
  const old = { ...LONG, 'dtu_KO_vs_WT.csv':
    'transcript_id,gene_id,usage_log2FC,pvalue,padj,gene_padj,mean_usage_num,mean_usage_den\n' +
    'T3,G2,1.1,1e-4,1e-3,1e-3,0.80,0.40\n' }
  const bo = await assemble(reader(old))
  check('an old usage_log2FC column is read as usage_effect',
    bo.dtuByContrast.KO_vs_WT[0].usage_effect, 1.1)
}

console.log('\nMISSING PIECES DEGRADE, THEY DO NOT THROW')
{
  const partial = { ...LONG }
  delete partial['dtu_KO_vs_WT.csv']
  delete partial['transcript_counts.csv']
  const b3 = await assemble(reader(partial))
  check('transcripts still read', b3.transcripts.length, 3)
  check('no usage table', b3.dtuByContrast, undefined)
  check('and the maths returns nothing', isoformGenes(b3, 'KO_vs_WT'), [])
}

console.log(failed ? `\n${failed} isoform test(s) failed\n` : '\nAll isoform tests passed\n')
process.exit(failed ? 1 : 0)
