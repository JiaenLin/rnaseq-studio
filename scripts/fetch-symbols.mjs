// Ensembl gene id -> symbol, packed into the assets the studio ships.
//
//   node scripts/fetch-symbols.mjs            # writes public/symbols/
//
// WHY THIS EXISTS. A bundle keyed by accession is readable by nobody and
// matchable by nothing: every table says ENSG00000141510 where it means TP53,
// the gene search finds nothing, and — the expensive one — MSigDB is written in
// symbols, so enrichment, GSEA and every gene set score against an accession
// background match zero genes and report an empty page rather than an error.
//
// scrnaseq-studio does not need this: its objects carry the symbols in a `var`
// column beside the accessions, so it converts BY INDEX with no lookup and no
// species assumption. A bundle that carries only accessions has nothing to
// convert from, so the table has to come from somewhere — here.
//
// From Ensembl BioMart, at build time, and committed. Same rule as the gene
// sets: CI and the deploy need no network, and the release the asset was built
// from is recorded so a stale one is visible rather than silent.

import { gzipSync } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1] : 'public/symbols'

const SPECIES = {
  human: { dataset: 'hsapiens_gene_ensembl', prefix: 'ENSG', label: 'Human' },
  mouse: { dataset: 'mmusculus_gene_ensembl', prefix: 'ENSMUSG', label: 'Mouse' },
}

const query = dataset => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Query>`
  + `<Query virtualSchemaName="default" formatter="TSV" header="0" uniqueRows="1" count="" datasetConfigVersion="0.6">`
  + `<Dataset name="${dataset}" interface="default">`
  + `<Attribute name="ensembl_gene_id"/><Attribute name="external_gene_name"/>`
  + `</Dataset></Query>`

async function fetchTsv(dataset) {
  // GET with the query in the URL, and redirects followed — the service answers
  // 405 to POST and 308 to an unfollowed GET, both of which look like an outage.
  const url = 'https://www.ensembl.org/biomart/martservice?query=' + encodeURIComponent(query(dataset))
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`BioMart ${dataset}: HTTP ${res.status}`)
  const text = await res.text()
  if (/Query ERROR|<html/i.test(text.slice(0, 400))) throw new Error(`BioMart ${dataset}: ${text.slice(0, 200)}`)
  return text
}

async function release() {
  const res = await fetch('https://rest.ensembl.org/info/data?content-type=application/json')
  const j = await res.json().catch(() => ({}))
  return `Ensembl ${(j.releases ?? []).join('/') || 'unknown'}`
}

/**
 * The packed format.
 *
 *   SYM1 <species> <release> <n canonical> <n other>
 *   <numeric id>\t<symbol>   one per line, ascending
 *   #                        separator
 *   <full id>\t<symbol>      anything not ENSG/ENSMUSG + 11 digits
 *
 * The numeric section is the whole file in practice, and storing 141510 rather
 * than "ENSG00000141510" is most of the saving before gzip even runs — the ids
 * are sorted, so the deltas compress to almost nothing.
 */
export function pack(rows, { species, prefix, release }) {
  const rx = new RegExp(`^${prefix}(\\d{11})$`)
  const canon = [], other = []
  for (const [id, sym] of rows) {
    const m = rx.exec(id)
    if (m) canon.push([Number(m[1]), sym]); else other.push([id, sym])
  }
  canon.sort((a, b) => a[0] - b[0])
  const head = `SYM1\t${species}\t${release}\t${canon.length}\t${other.length}`
  return {
    text: [head, ...canon.map(([n, s]) => `${n}\t${s}`), '#', ...other.map(([i, s]) => `${i}\t${s}`)].join('\n') + '\n',
    canonical: canon.length, other: other.length,
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith('fetch-symbols.mjs')) {
  mkdirSync(OUT, { recursive: true })
  const rel = await release()
  const manifest = { generated: new Date().toISOString().slice(0, 10), release: rel, species: {} }
  for (const [sp, spec] of Object.entries(SPECIES)) {
    process.stdout.write(`${spec.label}: querying BioMart… `)
    const tsv = await fetchTsv(spec.dataset)
    const rows = []
    let unnamed = 0
    for (const line of tsv.split('\n')) {
      const t = line.indexOf('\t')
      if (t < 0) continue
      const id = line.slice(0, t).trim()
      const sym = line.slice(t + 1).trim()
      if (!id) continue
      // A gene Ensembl has no name for keeps its accession downstream, which is
      // what already happens; recording it as its own symbol would be a lie
      // dressed as a mapping.
      if (!sym || sym === id) { unnamed++; continue }
      rows.push([id, sym])
    }
    const { text, other } = pack(rows, { species: sp, prefix: spec.prefix, release: rel })
    const gz = gzipSync(new TextEncoder().encode(text), { level: 9 })
    const file = `${sp}.sym`
    writeFileSync(join(OUT, file), gz)
    manifest.species[sp] = { label: spec.label, file, nGenes: rows.length, bytes: gz.length }
    console.log(`${rows.length} named (${unnamed} unnamed, ${other} non-canonical ids) `
      + `-> ${(gz.length / 1e6).toFixed(2)} MB gz`)
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`wrote ${OUT}/manifest.json · ${rel}`)
}
