// Builds a LOCAL data space: six simulated bundles in public/datasets/ and the
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
    // The one LONG-READ dataset, and the only way the Isoforms tab is
    // discoverable without a bundle of your own. Everything the tab needs is
    // simulated here: a transcript layer, per-isoform usage, and library
    // composition. See `longRead` in build().
    slug: 'heart-ageing-isoforms', species: 'mouse', reps: 3, nGenes: 16800,
    title: 'Heart, ageing — long reads',
    description: 'Nanopore direct RNA. Some genes keep their total and swap which isoform carries it — that is what the Isoforms tab is for, and no gene-level table can show it.',
    conditions: ['Young', 'Aged'],
    contrasts: [['Aged', 'Young']],
    signature: {
      Aged: { INFLAMMATORY_RESPONSE: 1.2, TNFA_SIGNALING_VIA_NFKB: 1.0, OXIDATIVE_PHOSPHORYLATION: -0.7, MYOGENESIS: -0.5 },
    },
    longRead: true,
    published: '2026-09-09',
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

  const extra = spec.longRead
    ? longReadLayer(spec, files, genes, nameOf, norm, samples, contrasts, rnd, gauss)
    : {}

  files['meta.json'] = JSON.stringify({
    schema: spec.longRead ? 2 : 1,
    project: spec.title, species: spec.species, created: spec.published,
    engine: 'desktop-R', control: spec.conditions[0], conditions: spec.conditions,
    gene_id_type: 'ensembl', counts_unit: 'DESeq2 normalized (median-of-ratios)',
    n_genes: spec.nGenes, n_samples: samples.length, contrasts, ...extra,
  }, null, 2)

  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 })
  writeFileSync(new URL(`${spec.slug}.zip`, OUT), zip)
  return {
    slug: spec.slug, title: spec.title, description: spec.description,
    url: `datasets/${spec.slug}.zip`, species: spec.species,
    bytes: zip.length, samples: samples.length, genes: spec.nGenes,
    conditions: spec.conditions, contrasts: contrasts.map(c => c.label),
    source: 'Simulated demo', published: spec.published,
    ...(spec.longRead ? { platform: 'long-read' } : {}),
  }
}

/**
 * A simulated isoform layer: transcripts, per-isoform usage, and composition.
 *
 * The point of the dataset is the SWITCH — a gene whose total does not move
 * while the isoform carrying it changes — because that is the finding long
 * reads exist for and the one thing no gene-level table can show. So switches
 * are planted deliberately rather than left to chance, in genes whose
 * gene-level fold change is near zero.
 *
 * Usage statistics in a real bundle come from DEXSeq, run by the pipeline. This
 * is a demo, so they are drawn — and `dtu_engine` says so, in as many words, to
 * keep the catalogue honest about which numbers are invented.
 */
function longReadLayer(spec, files, genes, nameOf, norm, samples, contrasts, rnd, gauss) {
  const [num, den] = [spec.contrasts[0][0], spec.contrasts[0][1]]
  const cid = contrasts[0].id
  const isN = samples.map(s => s.group === num)

  // Two or three isoforms for the first 2,600 genes; one for the rest, which is
  // roughly what an annotation looks like.
  const tx = []
  for (let gi = 0; gi < genes.length; gi++) {
    const n = gi < 900 ? 3 : gi < 2600 ? 2 : 1
    for (let k = 0; k < n; k++) {
      const novel = n > 1 && k === n - 1 && rnd() < 0.06
      tx.push({
        gi, k,
        id: novel ? `BambuTx${tx.length}` : `ENSMUST${String(gi * 7 + k).padStart(11, '0')}`,
        name: novel ? '' : `${nameOf(gi)}-2${String(k + 1).padStart(2, '0')}`,
        novel,
        cat: novel ? (rnd() < 0.5 ? 'novel_in_catalog' : 'novel_not_in_catalog') : 'full-splice_match',
      })
    }
  }
  // Switches: 40 multi-isoform genes whose gene-level effect is small.
  const switchGenes = new Set()
  for (let gi = 0; gi < 2600 && switchGenes.size < 40; gi++) {
    if (Math.abs(norm[gi][0] - norm[gi][samples.length - 1]) < 40) switchGenes.add(gi)
  }

  const novelSeen = new Map()
  const txRows = [], txCounts = [], dtuRows = [], dteRows = []
  for (const t of tx) {
    const sibs = tx.filter(x => x.gi === t.gi)
    const base = 1 / sibs.length
    const sw = switchGenes.has(t.gi) && sibs.length > 1
    // In a switch the first isoform hands its share to the second.
    const uDen = sw ? (t.k === 0 ? 0.82 : t.k === 1 ? 0.14 : 0.04) : base
    const uNum = sw ? (t.k === 0 ? 0.11 : t.k === 1 ? 0.85 : 0.04) : base
    let display = t.name
    if (!display) {
      const c = (novelSeen.get(t.gi) ?? 0) + 1; novelSeen.set(t.gi, c)
      display = `${nameOf(t.gi)}-novel-${c}`
    }
    txRows.push([t.id, genes[t.gi][0], nameOf(t.gi), t.name, display, t.cat,
      t.novel ? 'TRUE' : 'FALSE'].join(','))
    txCounts.push([t.id, display,
      ...norm[t.gi].map((v, si) => Math.round(v * (isN[si] ? uNum : uDen)))].join(','))
    if (sibs.length > 1) {
      const p = sw ? Math.max(1e-30, 10 ** (-8 - rnd() * 12)) : Math.min(1, 0.15 + rnd() * 0.85)
      dtuRows.push([t.id, genes[t.gi][0],
        (Math.log2((uNum + 1e-3) / (uDen + 1e-3))).toFixed(4),
        p.toExponential(3), Math.min(1, p * 8).toExponential(3),
        Math.min(1, p * 8).toExponential(3),
        uNum.toFixed(6), uDen.toFixed(6)].join(','))
    }
    const lfc = gauss() * 0.4 + (sw ? (t.k === 1 ? 1.6 : -1.6) : 0)
    const se = 0.25 + rnd() * 0.2
    const p = Math.max(1e-300, Math.min(1, tailP(lfc / se)))
    dteRows.push([t.id, (norm[t.gi][0] || 1).toFixed(2), lfc.toFixed(4), se.toFixed(4),
      p.toExponential(3), Math.min(1, p * 6).toExponential(3)].join(','))
  }

  files['transcripts.csv'] = csv(
    ['transcript_id', 'gene_id', 'gene_name', 'transcript_name', 'display_name',
      'structural_category', 'novel'], txRows)
  files['transcript_counts.csv'] = csv(
    ['transcript_id', 'display_name', ...samples.map(s => s.sample)], txCounts)
  files[`dtu_${cid}.csv`] = csv(
    ['transcript_id', 'gene_id', 'usage_effect', 'pvalue', 'padj', 'gene_padj',
      'mean_usage_num', 'mean_usage_den'], dtuRows)
  files[`dte_${cid}.csv`] = csv(
    ['transcript_id', 'baseMean', 'log2FoldChange', 'lfcSE', 'pvalue', 'padj'], dteRows)

  return {
    platform: 'long-read',
    transcript_layer: {
      annotation: 'transcripts.csv', counts: 'transcript_counts.csv',
      n_transcripts: tx.length, n_novel: tx.filter(t => t.novel).length,
      dte_files: { [cid]: `dte_${cid}.csv` },
      dtu_files: { [cid]: `dtu_${cid}.csv` },
      dtu_engine: 'simulated for this demo — a real bundle carries DEXSeq',
      dtu_effect_scale: 'log2 fold change of isoform usage',
      category_vocabulary: 'sqanti',
      dtu_filter: 'total counts >= 10 and >= 3 counts in >= 2 samples',
    },
    longread_qc: samples.map((s, i) => ({
      sample: s.sample,
      total_reads: Math.round(9e6 + rnd() * 7e6),
      unmapped_pct: +(6 + rnd() * 5).toFixed(1),
      mt_pct: +(22 + rnd() * 14).toFixed(1),
      rrna_pct: +(1 + rnd() * 2).toFixed(1),
      nuclear_alignments: Math.round(6e6 + rnd() * 4e6),
      median_read_length: Math.round(900 + rnd() * 500),
      read_n50: Math.round(1500 + rnd() * 700),
      median_polya: Math.round(60 + rnd() * 50),
      polya_called_pct: +(80 + rnd() * 12).toFixed(1),
      transcripts_detected: Math.round(tx.length * (0.55 + rnd() * 0.2)),
    })),
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
