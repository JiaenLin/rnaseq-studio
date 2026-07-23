// Generates a small, realistic sample result-bundle into public/sample/ so the
// deployed site has something to show immediately. Deterministic (seeded RNG).
// Run: node scripts/gen-sample.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample')
mkdirSync(outDir, { recursive: true })

// ── deterministic RNG ────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(42)
const gauss = () => {
  let u = 0, v = 0
  while (!u) u = rnd()
  while (!v) v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length
const vari = (a, m) => a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)

// ── design ───────────────────────────────────────────────────────────────────
const REAL = ['TP53','MYC','CD8A','IL6','STAT1','FOXP3','GAPDH','ACTB','VEGFA','EGFR',
  'BRCA1','CDKN1A','MKI67','PTEN','KRAS','JUN','FOS','NFKB1','CCND1','BAX','BCL2','SOD2',
  'HIF1A','TNF','IFNG','CXCL10','MMP9','COL1A1','ALB','INS']
const N = 3000
const samples = ['WT_1','WT_2','WT_3','WT_4','KO_1','KO_2','KO_3','KO_4']
const grp = samples.map(s => (s.startsWith('KO') ? 1 : 0))

const genes = Array.from({ length: N }, (_, i) => {
  const isDE = rnd() < 0.12
  return {
    id: 'ENSG' + String(10000000 + i).padStart(11, '0'),
    name: i < REAL.length ? REAL[i] : 'GENE' + String(i + 1).padStart(4, '0'),
    baseLog: 2 + rnd() * 10,
    effect: isDE ? (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 2.5) : gauss() * 0.1,
  }
})

// ── simulate normalized counts ───────────────────────────────────────────────
const counts = genes.map(g => samples.map((_, j) =>
  Math.max(0, Math.pow(2, g.baseLog + (grp[j] ? g.effect : 0) + gauss() * 0.35))))

// ── differential expression (Welch t on log2, normal-approx p, BH adjust) ─────
const erf = x => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
const phi = x => 0.5 * (1 + erf(x / Math.SQRT2))

const deg = genes.map((g, i) => {
  const logs = counts[i].map(v => Math.log2(v + 1))
  const wt = logs.filter((_, j) => grp[j] === 0)
  const ko = logs.filter((_, j) => grp[j] === 1)
  const mw = mean(wt), mk = mean(ko)
  const se = Math.sqrt(vari(wt, mw) / wt.length + vari(ko, mk) / ko.length) || 1e-9
  const t = (mk - mw) / se
  const p = Math.min(1, Math.max(2 * (1 - phi(Math.abs(t))), 1e-300))
  return { id: g.id, name: g.name, baseMean: mean(counts[i]), lfc: mk - mw, se, p }
})
// Benjamini–Hochberg
const order = [...deg.keys()].sort((a, b) => deg[a].p - deg[b].p)
const padj = new Array(N)
let prev = 1
for (let k = N - 1; k >= 0; k--) {
  const idx = order[k]
  prev = Math.min(prev, (deg[idx].p * N) / (k + 1))
  padj[idx] = prev
}

const nDeg = deg.filter((d, i) => padj[i] < 0.05 && Math.abs(d.lfc) >= 1).length

// ── enrichment (fabricated but plausible) ────────────────────────────────────
const SETS = {
  'GO:BP': ['inflammatory response','cell cycle','apoptotic process','immune response','angiogenesis','DNA repair','T cell activation','response to hypoxia','cytokine production','extracellular matrix organization'],
  'KEGG': ['Cytokine-cytokine receptor interaction','p53 signaling pathway','Cell cycle','PI3K-Akt signaling','Apoptosis','TNF signaling pathway','JAK-STAT signaling','HIF-1 signaling'],
  'Reactome': ['Interferon Signaling','Cell Cycle Checkpoints','Signaling by Interleukins','Programmed Cell Death','Extracellular matrix organization','DNA Double-Strand Break Repair'],
  'WikiPathways': ['Apoptosis','Cell cycle','TNF-alpha signaling','VEGFA-VEGFR2 pathway','Inflammatory Response Pathway'],
  'GSEA:H': ['HALLMARK_TNFA_SIGNALING_VIA_NFKB','HALLMARK_INFLAMMATORY_RESPONSE','HALLMARK_HYPOXIA','HALLMARK_P53_PATHWAY','HALLMARK_APOPTOSIS','HALLMARK_INTERFERON_GAMMA_RESPONSE','HALLMARK_E2F_TARGETS','HALLMARK_G2M_CHECKPOINT'],
}
// Draw plausible member genes for a set (biased to DEGs so heatmaps show signal).
const degPool = genes.filter((_, i) => padj[i] < 0.1).map(g => g.name)
const anyPool = genes.map(g => g.name)
function sampleMembers(n) {
  const pool = degPool.length >= n ? degPool : anyPool
  const picked = new Set()
  let guard = 0
  while (picked.size < Math.min(n, pool.length) && guard < n * 25) {
    picked.add(pool[Math.floor(rnd() * pool.length)]); guard++
  }
  return [...picked]
}

const enrich = []
let termN = 0
for (const [source, terms] of Object.entries(SETS)) {
  const method = source.startsWith('GSEA') ? 'GSEA' : 'ORA'
  terms.forEach((desc, k) => {
    const setSize = 40 + Math.floor(rnd() * 260)
    const count = method === 'GSEA' ? Math.floor(setSize * (0.2 + rnd() * 0.4)) : 8 + Math.floor(rnd() * 40)
    const p = Math.pow(10, -(1.3 + rnd() * 6))
    enrich.push({
      source, method,
      id: source.replace(/[:]/g, '') + String(++termN).padStart(4, '0'),
      description: desc,
      direction: method === 'GSEA' ? (rnd() < 0.5 ? 'up' : 'down') : (k % 3 === 0 ? 'down' : 'up'),
      setSize, count,
      score: method === 'GSEA' ? (rnd() < 0.5 ? -1 : 1) * (1.3 + rnd() * 1.4) : 1 + rnd() * 4,
      pvalue: p, padj: Math.min(1, p * 3),
      geneID: sampleMembers(count).join('/'),
    })
  })
}

// ── write files ──────────────────────────────────────────────────────────────
const csv = (header, rows) => [header.join(','), ...rows].join('\n') + '\n'

writeFileSync(join(outDir, 'samples.csv'),
  csv(['sample', 'condition'], samples.map(s => `${s},${s.startsWith('KO') ? 'KO' : 'WT'}`)))

writeFileSync(join(outDir, 'normalized_counts.csv'),
  csv(['gene_id', 'gene_name', ...samples],
    genes.map((g, i) => [g.id, g.name, ...counts[i].map(v => v.toFixed(2))].join(','))))

writeFileSync(join(outDir, 'deg_KO_vs_WT.csv'),
  csv(['gene_id', 'gene_name', 'baseMean', 'log2FoldChange', 'lfcSE', 'pvalue', 'padj'],
    deg.map((d, i) => [d.id, d.name, d.baseMean.toFixed(2), d.lfc.toFixed(4), d.se.toFixed(4),
      d.p.toExponential(3), padj[i].toExponential(3)].join(','))))

writeFileSync(join(outDir, 'enrichment_KO_vs_WT.csv'),
  csv(['source', 'method', 'id', 'description', 'direction', 'setSize', 'count', 'score', 'pvalue', 'padj', 'geneID'],
    enrich.map(e => [e.source, e.method, e.id, `"${e.description}"`, e.direction, e.setSize, e.count,
      e.score.toFixed(3), e.pvalue.toExponential(3), e.padj.toExponential(3), e.geneID].join(','))))

// genesets.csv (compact: one row per set, genes "/"-joined) — full memberships
// for live ORA. Each set = its enrichment members (DE-biased) padded to setSize.
const gsRows = []
for (const e of enrich) {
  const members = new Set(e.geneID.split('/').filter(Boolean))
  let guard = 0
  const target = Math.min(e.setSize, anyPool.length)
  while (members.size < target && guard < e.setSize * 6) { members.add(anyPool[Math.floor(rnd() * anyPool.length)]); guard++ }
  gsRows.push([e.source, e.id, `"${e.description}"`, [...members].join('/')].join(','))
}
writeFileSync(join(outDir, 'genesets.csv'), csv(['source', 'set_id', 'set_name', 'genes'], gsRows))

writeFileSync(join(outDir, 'meta.json'), JSON.stringify({
  schema: 1,
  project: 'Demo — KO vs WT (liver)',
  species: 'human',
  created: '2026-07-23',
  engine: 'sample-generator',
  control: 'WT',
  conditions: ['WT', 'KO'],
  gene_id_type: 'ensembl',
  counts_unit: 'DESeq2 normalized (median-of-ratios)',
  n_genes: N,
  n_samples: samples.length,
  contrasts: [{
    id: 'KO_vs_WT', numerator: 'KO', denominator: 'WT', label: 'KO vs WT',
    deg_file: 'deg_KO_vs_WT.csv', enrichment_file: 'enrichment_KO_vs_WT.csv',
    n_deg: nDeg, padj_threshold: 0.05, lfc_threshold: 1,
  }],
}, null, 2) + '\n')

console.log(`Sample bundle written to public/sample/ — ${N} genes, ${samples.length} samples, ${nDeg} DEGs.`)
