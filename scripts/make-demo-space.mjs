// Builds a LOCAL data space: five simulated bundles in public/datasets/ and the
// public/catalogue.json that lists them.
//
//   node scripts/make-demo-space.mjs        # or: npm run demo:space
//
// Both outputs are gitignored, and deliberately. A catalogue committed to this
// repository would ship to GitHub Pages, where the whole design is that
// /catalogue.json 404s and the panel does not render — and it would put five
// invented cohorts on a public site as if they were data. So: run this to see
// and work on the data-space UI; replace it with real bundles to deploy one.
// DEPLOY.md is the deployment half.
//
// The genes are real. Accessions and symbols are drawn, paired, from
// public/symbols/*.sym — so the mouse sets read Ucp1 and the human sets UCP1,
// and one dataset carries accessions with no symbol column at all, which is the
// only way to exercise the conversion in src/lib/symbols.ts by hand.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { zipSync, strToU8 } from 'fflate'

const OUT = new URL('../public/datasets/', import.meta.url)
const CATALOGUE = new URL('../public/catalogue.json', import.meta.url)
const SYM = sp => new URL(`../public/symbols/${sp}.sym`, import.meta.url)

const PREFIX = { human: 'ENSG', mouse: 'ENSMUSG' }
// Predicted and unnamed loci are most of the genome and none of the interest;
// a demo catalogue full of Gm20388 would look like a broken conversion.
const NOISE = /^(Gm\d+|A[CLP]\d{6}\.\d+|LINC\d+|MIR\d|.*Rik|.*-(AS|IT)\d|[A-Z]{2}\d{6}\.\d)$/

/** Real (accession, symbol) pairs for a species, in id order. */
function genePool(species) {
  // The assets are stored gzipped and served with Content-Encoding: gzip; a
  // browser never sees these bytes, so Node has to do what the browser does.
  const raw = readFileSync(SYM(species))
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8')
  const [head, ...lines] = text.split('\n')
  if (head.split('\t')[0] !== 'SYM1') throw new Error(`${species}.sym: not a SYM1 file`)
  const pool = []
  for (const line of lines) {
    if (!line || line === '#') { if (line === '#') break; continue }
    const t = line.indexOf('\t')
    const sym = line.slice(t + 1)
    if (!sym || NOISE.test(sym)) continue
    pool.push([`${PREFIX[species]}${line.slice(0, t).padStart(11, '0')}`, sym])
  }
  return pool
}

/** Hallmark sets for a species, id -> Set of symbols. See fetch-genesets.mjs. */
function hallmark(species) {
  const raw = readFileSync(new URL(`../public/genesets/${species}.hallmark.gs`, import.meta.url))
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8')
  const lines = text.trimEnd().split('\n')
  if (lines[0].split('\t')[0] !== 'MSIG1') throw new Error(`${species}.hallmark.gs: not an MSIG1 file`)
  const vocab = lines[1].split('\t')
  const sets = new Map()
  for (const line of lines.slice(2)) {
    const [id, , idx] = line.split('\t')
    sets.set(id, new Set(idx.split(',').map(i => vocab[+i])))
  }
  return sets
}

const mulberry32 = a => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const DATASETS = [
  {
    slug: 'brown-fat-cold-2026', species: 'mouse', reps: 4, nGenes: 18400,
    title: 'Brown adipose, cold exposure, Ucp1 knockout',
    description: 'Two genotypes at two temperatures. The genotype effect differs between them, so the interaction is the question — the Overlap tab is where you ask it.',
    conditions: ['WT_Thermo', 'WT_Cold', 'KO_Thermo', 'KO_Cold'],
    contrasts: [['WT_Cold', 'WT_Thermo'], ['KO_Cold', 'KO_Thermo'], ['KO_Cold', 'WT_Cold'], ['KO_Thermo', 'WT_Thermo']],
    // Cold drives thermogenesis in the wild type and cannot in the knockout,
    // which is the interaction the description promises. Whether the app finds
    // it is then a real question with a real answer.
    signature: {
      WT_Cold: { OXIDATIVE_PHOSPHORYLATION: 1.5, FATTY_ACID_METABOLISM: 1.3, ADIPOGENESIS: 1.1, MYC_TARGETS_V1: -0.8 },
      KO_Thermo: { OXIDATIVE_PHOSPHORYLATION: -0.6, TNFA_SIGNALING_VIA_NFKB: 0.7 },
      KO_Cold: { OXIDATIVE_PHOSPHORYLATION: -0.5, FATTY_ACID_METABOLISM: -0.4, INFLAMMATORY_RESPONSE: 1.4, TNFA_SIGNALING_VIA_NFKB: 1.3 },
    },
    published: '2026-08-14',
  },
  {
    slug: 'liver-hfd-timecourse', species: 'mouse', reps: 3, nGenes: 17900,
    title: 'Liver, high-fat diet time course',
    description: 'Chow against 4, 8 and 16 weeks of high-fat feeding. Ordered arms — set the figure order before exporting anything.',
    conditions: ['Chow', 'HFD_4w', 'HFD_8w', 'HFD_16w'],
    contrasts: [['HFD_4w', 'Chow'], ['HFD_8w', 'Chow'], ['HFD_16w', 'Chow']],
    // Metabolic first, inflammatory and fibrotic later — a time course that
    // orders, so the figure order matters and the Overlap tab has a nesting.
    signature: {
      HFD_4w: { FATTY_ACID_METABOLISM: 1.1, XENOBIOTIC_METABOLISM: 0.8, BILE_ACID_METABOLISM: -0.6 },
      HFD_8w: { FATTY_ACID_METABOLISM: 1.4, XENOBIOTIC_METABOLISM: 1.0, BILE_ACID_METABOLISM: -0.8, INFLAMMATORY_RESPONSE: 0.9 },
      HFD_16w: { FATTY_ACID_METABOLISM: 1.5, XENOBIOTIC_METABOLISM: 1.1, BILE_ACID_METABOLISM: -0.9, INFLAMMATORY_RESPONSE: 1.5, EPITHELIAL_MESENCHYMAL_TRANSITION: 1.3, TGF_BETA_SIGNALING: 1.1 },
    },
    published: '2026-07-02',
  },
  {
    slug: 'pbmc-vaccine-d7', species: 'human', reps: 6, nGenes: 19200, accessionsOnly: true,
    title: 'PBMC, vaccine response at day 7',
    description: 'Whole blood before and one week after a booster. Carries Ensembl accessions and no symbol column, so it opens asking to be converted.',
    conditions: ['D0', 'D7'],
    contrasts: [['D7', 'D0']],
    signature: {
      D7: { INTERFERON_ALPHA_RESPONSE: 1.9, INTERFERON_GAMMA_RESPONSE: 1.7, INFLAMMATORY_RESPONSE: 1.1, MYC_TARGETS_V1: -0.6 },
    },
    published: '2026-06-19',
  },
  {
    slug: 'ipsc-neuron-differentiation', species: 'human', reps: 3, nGenes: 19800,
    title: 'iPSC to cortical neuron, day 30',
    description: 'Undifferentiated iPSC against day-30 cortical neurons from the same three donors. A very large effect, useful as a sanity check.',
    conditions: ['iPSC', 'Neuron_D30'],
    contrasts: [['Neuron_D30', 'iPSC']],
    // Differentiation switches the cell cycle off; that is the largest and most
    // reliable thing in the comparison, and it is what hallmark can see.
    signature: {
      Neuron_D30: { E2F_TARGETS: -2.1, G2M_CHECKPOINT: -2.0, MYC_TARGETS_V1: -1.6, MITOTIC_SPINDLE: -1.4, APICAL_JUNCTION: 1.2, NOTCH_SIGNALING: 1.0, HEDGEHOG_SIGNALING: 1.0 },
    },
    published: '2026-05-08',
  },
  {
    slug: 'kidney-ischemia-reperfusion', species: 'mouse', reps: 4, nGenes: 18100,
    title: 'Kidney, ischemia–reperfusion injury',
    description: 'Sham against 24 h reperfusion. A strong injury signature — useful for checking a pipeline end to end.',
    conditions: ['Sham', 'IRI_24h'],
    contrasts: [['IRI_24h', 'Sham']],
    signature: {
      IRI_24h: { TNFA_SIGNALING_VIA_NFKB: 1.9, INFLAMMATORY_RESPONSE: 1.8, HYPOXIA: 1.5, APOPTOSIS: 1.2, P53_PATHWAY: 1.0, OXIDATIVE_PHOSPHORYLATION: -1.3, FATTY_ACID_METABOLISM: -1.1 },
    },
    published: '2026-04-11',
  },
]

const csv = (head, rows) => [head.join(','), ...rows].join('\n') + '\n'
const slugOf = (a, b) => `${a}_vs_${b}`.replace(/[^A-Za-z0-9_]+/g, '_')
// Two-sided normal tail. The cheap sqrt(1 - exp(-2z^2/pi)) approximation is
// fine in the middle and useless in the tail — it rounds to 1 past |z| ~ 6, so
// every strong gene gets p = 0 and the volcano becomes a flat wall at the top
// of the axis. Past that, use the asymptotic tail, which stays in floats.
const tailP = z => {
  const a = Math.abs(z)
  if (a < 6) return Math.min(1, 1 - Math.sqrt(1 - Math.exp(-2 * a * a / Math.PI)))
  return Math.exp(-a * a / 2) / (a * Math.sqrt(2 * Math.PI)) * (1 - 1 / (a * a))
}

function build(spec) {
  const rnd = mulberry32([...spec.slug].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261))
  const gauss = () => {
    let u = 0, v = 0
    while (!u) u = rnd(); while (!v) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const pool = genePool(spec.species)
  const step = Math.max(1, Math.floor(pool.length / spec.nGenes))
  const genes = Array.from({ length: spec.nGenes }, (_, i) => pool[(i * step) % pool.length])

  const samples = spec.conditions.flatMap(c =>
    Array.from({ length: spec.reps }, (_, i) => ({ sample: `${c}_${i + 1}`, condition: c })))

  // A lognormal base mean per gene, then a per-condition effect on 15% of them,
  // then noise. Enough structure for PCA, clustering and a volcano.
  const base = genes.map(() => Math.exp(1.8 + rnd() * 5.2))

  // Differential expression comes from two places. A little of it is scattered,
  // which is what real data looks like. Most of it is a signature: the genes of
  // a named hallmark set move together, in the direction the biology in
  // DATASETS says they move. Without that second part every gene is DE at
  // random, no gene set is enriched in any of them, and the enrichment tab —
  // the thing this application is for — reports nothing on every dataset in
  // the catalogue.
  const sets = spec.signature ? hallmark(spec.species) : null
  const members = new Map()
  for (const arm of Object.values(spec.signature ?? {}))
    for (const name of Object.keys(arm)) {
      const key = `HALLMARK_${name}`
      const set = sets.get(key)
      if (!set) throw new Error(`${spec.slug}: no hallmark set ${key}`)
      members.set(key, set)
    }
  const effect = genes.map(([, sym]) => spec.conditions.map((ci_, ci) => {
    let e = ci === 0 || rnd() > 0.05 ? 0 : gauss() * 1.2
    if (ci === 0) return 0
    const arm = spec.signature?.[spec.conditions[ci]]
    if (arm) for (const [name, weight] of Object.entries(arm))
      if (members.get(`HALLMARK_${name}`).has(sym)) e += weight * (0.65 + rnd() * 0.7)
    return e
  }))
  const noise = 0.22

  // Independent per-gene noise alone puts every replicate of a group on the
  // same PCA point — 18,000 independent draws average out, and the plot shows
  // four dots with the labels stacked on top of each other, which reads as a
  // broken figure. Real replicates differ along a few shared axes (batch,
  // library prep, an animal), so give each sample a score on three latent
  // factors that many genes load on. That is what makes replicates a cloud.
  const NF = 3
  const load = genes.map(() => Array.from({ length: NF }, () => (rnd() < 0.3 ? gauss() : 0)))
  const score = samples.map(() => Array.from({ length: NF }, () => gauss() * 0.45))
  const norm = genes.map((_, gi) => samples.map((s, si) => {
    let latent = 0
    for (let f = 0; f < NF; f++) latent += load[gi][f] * score[si][f]
    return base[gi] * 2 ** effect[gi][spec.conditions.indexOf(s.condition)] * Math.exp(latent + gauss() * noise)
  }))
  const size = samples.map(() => Math.exp(gauss() * 0.15))

  const files = {}
  files['samples.csv'] = csv(['sample', 'condition'], samples.map(s => `${s.sample},${s.condition}`))
  const nameOf = gi => (spec.accessionsOnly ? '' : genes[gi][1])
  const header = ['gene_id', 'gene_name', ...samples.map(s => s.sample)]
  files['normalized_counts.csv'] = csv(header,
    genes.map((g, gi) => [g[0], nameOf(gi), ...norm[gi].map(v => v.toFixed(2))].join(',')))
  files['raw_counts.csv'] = csv(header,
    genes.map((g, gi) => [g[0], nameOf(gi), ...norm[gi].map((v, si) => Math.round(v * size[si]))].join(',')))

  const contrasts = spec.contrasts.map(([num, den]) => {
    const id = slugOf(num, den)
    const ni = spec.conditions.indexOf(num), di = spec.conditions.indexOf(den)
    let nDeg = 0
    const rows = genes.map((g, gi) => {
      const lfc = effect[gi][ni] - effect[gi][di] + gauss() * 0.12
      const mean = norm[gi].reduce((a, b) => a + b, 0) / samples.length
      const sd = Math.sqrt(noise ** 2 + 0.3 * NF * 0.45 ** 2)
      const se = Math.max(0.08, sd * Math.sqrt(2 / spec.reps) + 1.6 / Math.sqrt(mean + 1))
      const p = Math.max(1e-300, Math.min(1, tailP(lfc / se)))
      // Not a real BH — a monotone squeeze that keeps the ranking and lands the
      // DEG count somewhere a reader would believe.
      const padj = Math.min(1, p * 6)
      if (padj < 0.05 && Math.abs(lfc) >= 1) nDeg++
      return [g[0], nameOf(gi), mean.toFixed(2), lfc.toFixed(4), se.toFixed(4), p.toExponential(3), padj.toExponential(3)].join(',')
    })
    files[`deg_${id}.csv`] = csv(['gene_id', 'gene_name', 'baseMean', 'log2FoldChange', 'lfcSE', 'pvalue', 'padj'], rows)
    return { id, numerator: num, denominator: den, label: `${num} vs ${den}`, deg_file: `deg_${id}.csv`, n_deg: nDeg, padj_threshold: 0.05, lfc_threshold: 1 }
  })

  files['meta.json'] = JSON.stringify({
    schema: 1, project: spec.title, species: spec.species, created: spec.published,
    engine: 'desktop-R', control: spec.conditions[0], conditions: spec.conditions,
    gene_id_type: 'ensembl', counts_unit: 'DESeq2 normalized (median-of-ratios)',
    n_genes: spec.nGenes, n_samples: samples.length, contrasts,
  }, null, 2)

  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 })
  writeFileSync(new URL(`${spec.slug}.zip`, OUT), zip)
  return {
    slug: spec.slug, title: spec.title, description: spec.description,
    url: `datasets/${spec.slug}.zip`, species: spec.species,
    bytes: zip.length, samples: samples.length, genes: spec.nGenes,
    conditions: spec.conditions, contrasts: contrasts.map(c => c.label),
    source: 'Simulated demo', published: spec.published,
  }
}

mkdirSync(OUT, { recursive: true })
const datasets = DATASETS.map(spec => {
  const entry = build(spec)
  console.log(`${entry.slug.padEnd(30)} ${String(entry.samples).padStart(2)} samples · ${(entry.bytes / 1e6).toFixed(2)} MB`)
  return entry
})
writeFileSync(CATALOGUE, JSON.stringify({
  name: 'Demo data space', updated: new Date().toISOString().slice(0, 10), datasets,
}, null, 2) + '\n')
console.log(`\npublic/catalogue.json — ${datasets.length} datasets, all simulated, both outputs gitignored`)
