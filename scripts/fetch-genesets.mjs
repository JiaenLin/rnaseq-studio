// Pack MSigDB into the compact assets the studio ships.
//
//   Rscript scripts/export-genesets.R scratch-msigdb/gmt   # 1. export
//   node scripts/fetch-genesets.mjs                        # 2. pack
//
// Two steps because they need different things: the export needs R and
// msigdbr, the packing needs fflate and the format the app parses. Splitting
// them also means the packing can be re-run — to change what is on by default,
// or to add a collection — without going back to the database.
//
// The outputs are committed, so CI and the deploy need no network and no R.
// Re-run both when MSigDB releases; the app prints the release it is using, so
// a stale asset is visible rather than silent.

import { gzipSync } from 'fflate'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { deriveMetabolic } from './derive-metabolic.mjs'

const inArg = process.argv.indexOf('--in')
const IN = inArg > 0 ? process.argv[inArg + 1] : 'scratch-msigdb/gmt'
const outArg = process.argv.indexOf('--out')
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/genesets'

/**
 * Which collections a species starts with.
 *
 * The rest are downloadable and off: the app fetches a collection the first
 * time it is switched on, so an immunology library nobody has asked for costs
 * nothing. Hallmark, KEGG, Reactome, WikiPathways and GO:BP are the ones people
 * mean by "pathway enrichment". Cell-type signatures are on because bulk
 * RNA-seq is a tissue mixture: a shift in a cell-type signature is how a change
 * in composition shows up in a bulk contrast, and reading it as a change in
 * regulation is the mistake worth making visible.
 *
 * Metabolic is off, and deliberately. It is assembled from the collections
 * above rather than published beside them, so a reader who leaves the defaults
 * on and turns it on as well is testing part of the library twice — a real
 * cost, stated on the card, and not one to opt somebody into.
 */
const ON = new Set(['Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways',
  'PID', 'GO:BP', 'Cell type'])

/**
 * The order collections are offered in, grouped the way MSigDB groups them.
 *
 * EVERY label the exporter writes must appear here. `unslug` is built from this
 * list, so a collection missing from it is not offered in some other order —
 * it is dropped from the manifest with no error at any point. That is how
 * mouse KEGG went missing once already, and it is why this list is now checked
 * against the input directory rather than trusted.
 */
const ORDER = [
  // Curated pathways — what most people mean by "pathway enrichment".
  'Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways', 'PID',
  'BioCarta', 'Canonical (other)',
  // Ontologies.
  'GO:BP', 'GO:MF', 'GO:CC', 'Human phenotype', 'Tumour phenotype',
  // Signatures from experiments.
  'Cell type', 'Perturbations', 'Immunologic', 'Vaccine response', 'Oncogenic',
  // Regulatory targets.
  'TF targets', 'miRNA targets',
  // Cancer and genome position.
  'Cancer atlas (3CA)', 'Cancer modules', 'Cancer neighbourhoods',
  'Copy-number correlates', 'Positional',
]

/**
 * Collections that are NOT a native annotation for their species.
 *
 * Mouse KEGG is human KEGG mapped through orthologs, because no native one is
 * distributable. It is a weaker claim than the rest of the library and the
 * interface says so wherever it appears, rather than letting it sit in a row
 * of native collections looking like one of them.
 */
const PROJECTED = new Set(['KEGG (orthologs)'])

/**
 * What a collection is, where its name does not settle it.
 *
 * "Mouse phenotype" was the wrong name for MSigDB's M5:MPT and sat directly
 * under human's "Human phenotype" in this very list, which made it read as the
 * mouse counterpart of the Human Phenotype Ontology. It is not: HPO is 5 793
 * sets covering every human phenotype, MPT is 92 sets and every one of them is
 * a tumour. The name says so now, and this says the rest.
 */
const NOTES = {
  'Tumour phenotype': 'MSigDB M5:MPT — tumour phenotype terms mined out of the '
    + 'Mammalian Phenotype Ontology. Neoplasia only, not the whole MP ontology.',
}

const LABEL = {
  human: { label: 'Human', taxon: 'Homo sapiens' },
  mouse: { label: 'Mouse', taxon: 'Mus musculus' },
}

/**
 * Back from a file slug to the collection label the R export used.
 *
 * Character for character what slug() in export-genesets.R does, TRAILING DASH
 * INCLUDED — "KEGG (orthologs)" ends in a bracket, so a naive slug leaves
 * "kegg-orthologs-" while R writes "kegg-orthologs", the lookup misses, and the
 * collection is silently dropped from the manifest with no error anywhere.
 * Two slug functions that must agree, in two languages; they agree here.
 */
const slugOf = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Filename -> label, from the side that chose the filenames.
 *
 * The exporter now writes `sources.json` recording the slug it actually used
 * for each collection, so this stops being a second implementation of R's
 * slug() that has to agree with it character for character. The recomputed map
 * remains as a fallback, for a GMT directory produced before that file existed.
 */
const sidecar = (() => {
  const at = join(IN, 'sources.json')
  if (!existsSync(at)) return null
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(at, 'utf8'))))
  } catch { return null }
})()
const guessed = new Map(ORDER.map(s => [slugOf(s), s]))
const labelFor = (file, species) =>
  sidecar?.get(file) ?? guessed.get(file.slice(species.length + 1).replace(/\.gmt$/, ''))

/**
 * MSigDB's systematic name, made readable.
 *
 * The prefix repeats the collection, which the app shows in its own column, so
 * it goes. The rest is lower-cased with the first letter raised — the
 * convention every enrichment tool prints. The systematic name stays as the id
 * and is what the CSV export carries, so nothing is lost by making the screen
 * readable.
 */
/**
 * Only a prefix that REPEATS THE COLLECTION comes off.
 *
 * PID and MP were missing, and MP is the one that shows the rule: HP_ comes off
 * human phenotype sets and MP_ stayed on the mouse ones, so every set of that
 * collection read "Mp abnormal tumor vascularization" while its human
 * counterpart read "11 pairs of ribs". METABOLIC_ is deliberately NOT here, though it leads
 * 100% of the derived collection's ids: derive-metabolic.mjs names those sets
 * itself, as "Adipogenesis (Hallmark)", so that each one says which parent it
 * was selected out of. Adding it and re-deriving the names replaced 4 970 of
 * those with "Hallmark adipogenesis" — worse, and caught only by reading the
 * diff.
 *
 * What is NOT here matters as much. GAVISH_, CUI_ and GENES_ each lead 100% of
 * their collection's ids and none is a prefix: the first two are the authors of
 * the study the sets come from, which is the citation, and the third is the
 * first word of "genes correlated with ABL2 deletion". Stripping a token
 * because it is common would delete those. Checked: PID_, MP_ and METABOLIC_
 * occur in no collection but their own.
 */
export function readableName(systematic) {
  const body = systematic.replace(
    /^(HALLMARK|GOBP|GOMF|GOCC|KEGG_MEDICUS|KEGG|REACTOME|WP|BIOCARTA|HP|MP|PID|MODULE)_/, '')
  const words = body.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * GMT text -> the compact payload the app parses.
 *
 * One dictionary of symbols, then one line per set holding indices into it.
 * A gene sits in many sets — Actb is in 349 of mouse GO:BP's 7 781 — so writing
 * the symbol once and referring to it by number is most of the saving, and the
 * indices gzip better than repeated names would.
 */
export function compact(gmt, { species, source, release }) {
  const dict = new Map()
  const lines = []
  for (const raw of gmt.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const id = parts[0]
    const idx = []
    for (let i = 2; i < parts.length; i++) {
      const g = parts[i]
      if (!g) continue
      let at = dict.get(g)
      if (at === undefined) { at = dict.size; dict.set(g, at) }
      idx.push(at)
    }
    if (!idx.length) continue
    lines.push(`${id}\t${readableName(id)}\t${idx.join(',')}`)
  }
  const head = `MSIG1\t${species}\t${source}\t${release}\t${lines.length}\t${dict.size}`
  return {
    text: `${head}\n${[...dict.keys()].join('\t')}\n${lines.join('\n')}\n`,
    nSets: lines.length,
    nGenes: dict.size,
  }
}

/**
 * Everything below packs; everything above is pure and exported.
 *
 * Guarded because the exports are the testable half and importing them used to
 * RUN the packer — which exits 1 when there is no GMT export, so the only way
 * to test `readableName` against the real regex was to copy the regex into the
 * test. A test that copies the thing it is testing passes while the original is
 * wrong, which is how a prefix stayed unstripped for a whole collection.
 */
const RUN_AS_SCRIPT = import.meta.main
  ?? (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1])))
if (!RUN_AS_SCRIPT) { /* imported for its exports */ }
else {

if (!existsSync(IN)) {
  console.error(`No GMT export at ${IN}.\n`
    + `Run:  Rscript scripts/export-genesets.R ${IN}`)
  process.exit(1)
}

const release = JSON.parse(readFileSync(join(IN, 'release.json'), 'utf8'))
mkdirSync(OUT, { recursive: true })

const manifest = { generated: new Date().toISOString().slice(0, 10), msigdbr: release.msigdbr, species: {} }
let rawTotal = 0, gzTotal = 0

for (const species of ['human', 'mouse']) {
  const all = readdirSync(IN)
    .filter(f => f.startsWith(`${species}.`) && f.endsWith('.gmt'))
    .map(f => ({ file: f, source: labelFor(f, species) }))
  // Loudly. A GMT whose label is not in ORDER used to be filtered away here in
  // silence, so a collection could be exported, packed against nothing, and be
  // absent from the app with every step reporting success. It has happened —
  // mouse KEGG, over a trailing dash in one of the two slug functions.
  const orphans = all.filter(f => !f.source).map(f => f.file)
  if (orphans.length) {
    console.error(`\n  ${species}: ${orphans.length} GMT file(s) match no label in ORDER:`)
    for (const o of orphans) console.error(`    ${o}`)
    console.error('  Add them to ORDER in this file, or delete them from the input.\n')
    process.exitCode = 1
  }
  const files = all.filter(f => f.source)
    .sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source))
  if (!files.length) continue

  const sources = []
  console.log(`\n${LABEL[species].label}  (MSigDB ${release[species]})`)
  for (const { file, source } of files) {
    const gmt = readFileSync(join(IN, file), 'utf8')
    const { text, nSets, nGenes } = compact(gmt, { species, source, release: release[species] })
    const gz = gzipSync(new TextEncoder().encode(text), { level: 9 })
    const name = `${species}.${basename(file, '.gmt').slice(species.length + 1)}.gs`
    writeFileSync(join(OUT, name), gz)
    rawTotal += gmt.length
    gzTotal += gz.length
    sources.push({ source, file: name, nSets, nGenes, bytes: gz.length,
      on: ON.has(source), projected: PROJECTED.has(source),
      ...(NOTES[source] ? { note: NOTES[source] } : {}) })
    console.log(`  ${source.padEnd(14)} ${String(nSets).padStart(5)} sets  `
      + `${String(nGenes).padStart(6)} genes  `
      + `gmt ${(gmt.length / 1e6).toFixed(2)} MB -> gz ${(gz.length / 1e6).toFixed(2)} MB`
      + (ON.has(source) ? '  [on]' : '') + (PROJECTED.has(source) ? '  [orthologs]' : ''))
  }
  manifest.species[species] = { ...LABEL[species], release: release[species], sources }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// The derived collections, from the files just written rather than from the GMT
// export — so what is selected is selected out of exactly the bytes the app
// loads, and so re-running this script cannot leave them behind. It rewrites
// the manifest it was just handed.
console.log('\nDerived')
deriveMetabolic(OUT)

const on = Object.values(manifest.species)
  .flatMap(s => s.sources.filter(x => x.on).map(x => x.bytes))
  .reduce((a, b) => a + b, 0)
console.log(`\n  total     gmt ${(rawTotal / 1e6).toFixed(1)} MB -> gz ${(gzTotal / 1e6).toFixed(1)} MB committed`)
console.log(`  on first open, per species: about ${(on / 2 / 1e6).toFixed(1)} MB`)
console.log(`  wrote ${OUT}/manifest.json`)

}
