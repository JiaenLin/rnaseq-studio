// Ensembl accession -> gene symbol, for a bundle that carries only accessions.
//
// Such a bundle is readable by nobody and matchable by nothing. Every table says
// ENSG00000141510 where it means TP53, the gene search finds nothing, and — the
// expensive one, because it looks like an empty result rather than a missing
// feature — MSigDB is written in symbols, so ORA, GSEA and every gene-set score
// fold an accession background against symbol sets, match zero genes, and report
// a page with nothing on it.
//
// scrnaseq-studio solved the same problem without a table: its objects carry the
// symbols in a `var` column beside the accessions, so it converts BY INDEX, with
// no species assumption and nothing to go stale. A bundle with only accessions
// has nothing to convert from, so the table has to come from somewhere —
// scripts/fetch-symbols.mjs, Ensembl BioMart, committed like the gene sets.
//
// What DOES port from over there is the part that is easy to get wrong:
//
//   NOTHING IS MERGED. Several accessions genuinely map to one symbol. Summing
//   them, or letting one silently win, puts two genes' measurements under one
//   name. Both rows keep their own row and their own accession — which this
//   app already prints beside the symbol in every table — and the count of them
//   is reported rather than left to be discovered.
//
//   THE ACCESSION IS NEVER LOST. A symbol is not a stable identifier. The
//   matrix stays indexed by both, so an accession typed into the gene search
//   still finds its row after the conversion.

import type { Bundle, CountsMatrix, DEGRow } from '../types'
import { detectSpecies, type Species } from './species.ts'

export interface SymbolMap {
  species: Species
  release: string
  size: number
  get(id: string): string | undefined
}

/** Ensembl's canonical gene ids, which is what the packed asset stores as ints. */
const CANON: Record<Species, RegExp> = {
  human: /^ENSG(\d{11})$/i,
  mouse: /^ENSMUSG(\d{11})$/i,
}

/**
 * The packed asset. See scripts/fetch-symbols.mjs for the format.
 *
 * Version-stamped and length-checked like the gene-set files, so a truncated
 * download is an error here rather than a map that quietly knows half the
 * genome.
 */
export function parseSymbols(text: string): SymbolMap {
  const nl = text.indexOf('\n')
  const head = text.slice(0, nl < 0 ? undefined : nl).split('\t')
  if (head[0] !== 'SYM1') throw new Error(`unknown symbol map format ${JSON.stringify(head[0])}`)
  const species = head[1] as Species
  const release = head[2]
  const nCanon = Number(head[3]), nOther = Number(head[4])
  const rx = CANON[species]
  if (!rx) throw new Error(`symbol map for an unknown species ${JSON.stringify(species)}`)

  const byNum = new Map<number, string>()
  const byId = new Map<string, string>()
  let inOther = false
  let at = nl + 1
  while (at > 0 && at < text.length) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    const line = text.slice(at, end)
    at = end + 1
    if (!line) continue
    if (line === '#') { inOther = true; continue }
    const t = line.indexOf('\t')
    if (t < 0) continue
    if (inOther) byId.set(line.slice(0, t).toUpperCase(), line.slice(t + 1))
    else byNum.set(Number(line.slice(0, t)), line.slice(t + 1))
  }
  if (byNum.size !== nCanon || byId.size !== nOther) {
    throw new Error(`symbol map claims ${nCanon}+${nOther} entries and carries ${byNum.size}+${byId.size}`)
  }

  return {
    species, release, size: byNum.size + byId.size,
    get(id) {
      const t = id.trim()
      // Version suffixes are routine in a counts matrix and are not part of the
      // identifier: ENSG00000141510.17 is TP53.
      const bare = t.replace(/\.\d+$/, '')
      const m = rx.exec(bare)
      return m ? byNum.get(Number(m[1])) : byId.get(bare.toUpperCase())
    },
  }
}

let manifestPromise: Promise<SymbolManifest> | null = null
const maps = new Map<Species, Promise<SymbolMap>>()

export interface SymbolManifest {
  generated: string
  release: string
  species: Record<string, { label: string; file: string; nGenes: number; bytes: number }>
}

const base = () => `${import.meta.env?.BASE_URL ?? '/'}symbols/`

export function loadSymbolManifest(): Promise<SymbolManifest> {
  manifestPromise ??= fetch(`${base()}manifest.json`).then(r => {
    if (!r.ok) throw new Error(`symbol map manifest: HTTP ${r.status}`)
    return r.json()
  })
  return manifestPromise
}

/** Fetched once per species and kept for the life of the tab. */
export function loadSymbols(species: Species): Promise<SymbolMap> {
  let p = maps.get(species)
  if (!p) {
    p = (async () => {
      const m = await loadSymbolManifest()
      const spec = m.species[species]
      if (!spec) throw new Error(`no symbol map for ${species}`)
      const res = await fetch(`${base()}${spec.file}`)
      if (!res.ok) throw new Error(`symbol map: HTTP ${res.status}`)
      const { gunzipSync } = await import('fflate')
      return parseSymbols(new TextDecoder().decode(gunzipSync(new Uint8Array(await res.arrayBuffer()))))
    })()
    maps.set(species, p)
  }
  return p
}

/* ─────────────────────── is this bundle in accessions? ────────────────────── */

export interface SymbolNeed {
  /** True when converting would actually change something. */
  needed: boolean
  species: Species
  /** Rows whose only name is an Ensembl accession. */
  accessions: number
  total: number
}

/**
 * Whether this bundle is keyed by accession and has no names of its own.
 *
 * Deliberately NOT "does it contain accessions": a bundle that carries symbols
 * in gene_name is already fine however its ids are spelled, and converting it
 * would replace the exporter's own names with Ensembl's for no gain. The
 * question is whether a row has any name BUT its accession.
 */
export function symbolNeed(bundle: Bundle): SymbolNeed {
  const m = bundle.counts
  const n = m.geneIds.length
  let named = 0, accessions = 0
  for (let i = 0; i < n; i++) {
    const nm = m.geneNames[i]
    if (nm && nm !== m.geneIds[i]) named++
    if (/^ENS(MUS)?G\d{11}(\.\d+)?$/i.test(m.geneIds[i])) accessions++
  }
  const detected = detectSpecies(m.geneIds)
  return {
    // A handful of named rows in an otherwise accession-keyed matrix is still a
    // matrix nobody can read; a mostly-named one is the exporter's own naming
    // and is left alone.
    needed: accessions > n * 0.5 && named < n * 0.5 && detected.from === 'accession',
    species: detected.species,
    accessions,
    total: n,
  }
}

/* ──────────────────────────── the conversion ──────────────────────────────── */

export interface Conversion {
  mapped: number
  /** Rows Ensembl has no symbol for; they keep their accession. */
  unmapped: number
  /** Rows whose symbol names at least one other row too. */
  duplicated: number
  total: number
  release: string
}

/** The matrix with `geneNames` filled in and the index rebuilt over both names. */
function renameMatrix(m: CountsMatrix, map: SymbolMap): { m: CountsMatrix; names: string[] } {
  const names = m.geneIds.map((id, i) => map.get(id) ?? m.geneNames[i] ?? '')
  const index = new Map<string, number>()
  for (let i = 0; i < m.geneIds.length; i++) {
    // The accession first, so it is never displaced by a symbol that names two
    // rows: an accession typed into the search must always find its own row.
    index.set(m.geneIds[i].toUpperCase(), i)
  }
  for (let i = 0; i < m.geneIds.length; i++) {
    const nm = names[i]
    if (nm && !index.has(nm.toUpperCase())) index.set(nm.toUpperCase(), i)
  }
  return { m: { ...m, geneNames: names, index }, names }
}

/**
 * The whole bundle, in symbols.
 *
 * Rewritten in ONE place — the matrices and every DEG table — because everything
 * downstream reads its gene names from those: the search index, the DEG table,
 * the volcano, the enrichment background, the GSEA ranking, the Overlap labels.
 * Converting at each of those instead would be six chances to miss one.
 */
export function applySymbols(bundle: Bundle, map: SymbolMap): { bundle: Bundle; report: Conversion } {
  const counts = renameMatrix(bundle.counts, map)
  const raw = bundle.rawCounts ? renameMatrix(bundle.rawCounts, map) : null

  let mapped = 0, unmapped = 0
  const count = new Map<string, number>()
  for (let i = 0; i < bundle.counts.geneIds.length; i++) {
    const nm = counts.names[i]
    if (nm && nm !== bundle.counts.geneIds[i]) {
      mapped++
      count.set(nm, (count.get(nm) ?? 0) + 1)
    } else unmapped++
  }
  let duplicated = 0
  for (const n of count.values()) if (n > 1) duplicated += n

  const byId = new Map<string, string>()
  for (let i = 0; i < bundle.counts.geneIds.length; i++) {
    if (counts.names[i]) byId.set(bundle.counts.geneIds[i], counts.names[i])
  }
  const rename = (rows: DEGRow[]): DEGRow[] =>
    rows.map(r => {
      const nm = map.get(r.gene_id) ?? byId.get(r.gene_id)
      return nm && nm !== r.gene_name ? { ...r, gene_name: nm } : r
    })
  const degByContrast: Record<string, DEGRow[]> = {}
  for (const [id, rows] of Object.entries(bundle.degByContrast)) degByContrast[id] = rename(rows)

  return {
    bundle: { ...bundle, counts: counts.m, rawCounts: raw?.m ?? bundle.rawCounts, degByContrast },
    report: { mapped, unmapped, duplicated, total: bundle.counts.geneIds.length, release: map.release },
  }
}
