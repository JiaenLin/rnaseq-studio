// Generates a deliberately punishing bundle for manual UI testing:
// 23 combinatorial arms, 69 samples, 8 contrasts, names full of "+" and "-",
// and identifiers that look like numbers ("517E2" parses as 51700 in scientific
// notation — the bug that motivated scripts/test-bundle.mjs).
//
//   node scripts/gen-stress-bundle.mjs [outfile]     default: stress-bundle.zip
//
// Load the result with "Open bundle (.zip)" and check that:
//   • all 23 arms appear (517E2 must NOT be missing)
//   • no two arms share a colour
//   • arm names are readable in the single-gene and module plots
//   • the faceted per-gene panel shows a legend, not colliding tick labels
import { writeFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'

const CONDITIONS = [
  '517E2', '51701',
  '517E2+RSL3', '517E2+RSL3+Fer1', '517E2+RSL3+CoQ10',
  '517E2+BFA', '517E2+BFA+Fer1', '517E2+BFA+CoQ10',
  '51701+Fer1', '51701+CoQ10',
  'shCtrl', 'shArf1-1', 'shArf1-2',
  'shArf1-1+Fer1', 'shArf1-1+CoQ10', 'shArf1-2+Fer1', 'shArf1-2+CoQ10',
  'shAUTS43-1', 'shAUTS43-2',
  'shAUTS43-1+Fer1', 'shAUTS43-1+CoQ10', 'shAUTS43-2+Fer1', 'shAUTS43-2+CoQ10',
]
const REPS = 3
const NGENES = 2000

const mulberry32 = a => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rnd = mulberry32(7)
const gauss = () => {
  let u = 0, v = 0
  while (!u) u = rnd(); while (!v) v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const samples = CONDITIONS.flatMap(c =>
  Array.from({ length: REPS }, (_, i) => ({ sample: `${c}_r${i + 1}`, condition: c })))

const REAL = ['TP53','MYC','IL6','STAT1','GAPDH','ACTB','VEGFA','EGFR','CDKN1A','MKI67',
  'BAX','BCL2','SOD2','HIF1A','TNF','GPX4','ACSL4','SLC7A11','FTH1','NCOA4','ARF1','AUTS2','PTGS2','NFE2L2']
const genes = Array.from({ length: NGENES }, (_, i) => ({
  id: i < REAL.length ? REAL[i] : `GENE${String(i).padStart(4, '0')}`,
  base: Math.exp(2 + rnd() * 6),
  effect: CONDITIONS.map(() => (rnd() < 0.15 ? gauss() * 1.4 : 0)),
}))
const counts = genes.map(g => samples.map(s =>
  Math.max(0, g.base * Math.pow(2, g.effect[CONDITIONS.indexOf(s.condition)]) * Math.exp(gauss() * 0.25))))

const csv = (head, rows) => [head.join(','), ...rows].join('\n') + '\n'
const files = {}
files['samples.csv'] = csv(['sample', 'condition'], samples.map(s => `${s.sample},${s.condition}`))
files['normalized_counts.csv'] = csv(
  ['gene_id', 'gene_name', ...samples.map(s => s.sample)],
  genes.map((g, gi) => [g.id, g.id, ...counts[gi].map(v => v.toFixed(2))].join(',')))
// Raw integer counts, so Studio can run DESeq2 on pairs this export omits.
files['raw_counts.csv'] = csv(
  ['gene_id', 'gene_name', ...samples.map(s => s.sample)],
  genes.map((g, gi) => [g.id, g.id, ...counts[gi].map(v => String(Math.round(v)))].join(',')))

const CONTRASTS = [
  ['517E2+RSL3', '517E2'], ['517E2+RSL3+Fer1', '517E2+RSL3'], ['517E2+BFA', '517E2'],
  ['51701', '517E2'], ['shArf1-1', 'shCtrl'], ['shArf1-2', 'shCtrl'],
  ['shAUTS43-1', 'shCtrl'], ['shAUTS43-2', 'shCtrl'],
]
const contrasts = CONTRASTS.map(([num, den]) => {
  const id = `${num}_vs_${den}`
  const ni = CONDITIONS.indexOf(num), di = CONDITIONS.indexOf(den)
  let nDeg = 0
  const rows = genes.map(g => {
    const lfc = g.effect[ni] - g.effect[di] + gauss() * 0.12
    const p = Math.abs(lfc) > 0.8 ? Math.pow(10, -2 - rnd() * 8) : rnd()
    const padj = Math.min(1, p * 4)
    if (padj < 0.05 && Math.abs(lfc) >= 1) nDeg++
    return [g.id, g.id, g.base.toFixed(2), lfc.toFixed(4), '0.2', p.toExponential(3), padj.toExponential(3)].join(',')
  })
  files[`deg_${id}.csv`] = csv(
    ['gene_id', 'gene_name', 'baseMean', 'log2FoldChange', 'lfcSE', 'pvalue', 'padj'], rows)
  return { id, numerator: num, denominator: den, label: `${num} vs ${den}`, deg_file: `deg_${id}.csv`, n_deg: nDeg }
})

const gsRows = []
for (let s = 0; s < 40; s++) {
  const members = new Set()
  for (let k = 0; k < 25; k++) members.add(genes[Math.floor(rnd() * NGENES)].id)
  gsRows.push(`Hallmark,HS_${s},HALLMARK_SET_${s},${[...members].join('/')}`)
}
files['genesets.csv'] = csv(['source', 'set_id', 'set_name', 'genes'], gsRows)

files['meta.json'] = JSON.stringify({
  schema: 1,
  project: 'Ferroptosis combinatorial screen (stress test)',
  species: 'human',
  created: new Date().toISOString().slice(0, 10),
  engine: 'desktop-R',
  control: '517E2',
  conditions: CONDITIONS,
  gene_id_type: 'symbol',
  counts_unit: 'DESeq2 normalized (median-of-ratios)',
  n_genes: NGENES,
  n_samples: samples.length,
  contrasts,
}, null, 2)

const out = process.argv[2] || 'stress-bundle.zip'
writeFileSync(out, zipSync(Object.fromEntries(
  Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 }))
console.log(`${out} — ${CONDITIONS.length} conditions, ${samples.length} samples, ${NGENES} genes, ${contrasts.length} contrasts`)
