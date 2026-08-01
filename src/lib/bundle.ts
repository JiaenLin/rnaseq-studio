import Papa from 'papaparse'
import { unzipSync } from 'fflate'
import type {
  Bundle, BundleMeta, SampleRow, DEGRow, EnrichmentRow, CountsMatrix, GeneSetDef,
} from '../types'

// A Reader resolves a file name within a bundle to its text, or null if absent.
export type Reader = (name: string) => Promise<string | null>

// dynamicTyping is OFF on purpose. It coerces anything number-shaped, and real
// identifiers are often number-shaped: a condition called "517E2" is read as
// scientific notation and becomes 51700, which then matches nothing in
// meta.conditions — the group silently disappears from every plot. Gene ids and
// sample names have the same exposure. Everything is parsed as text here and the
// genuinely numeric columns are coerced explicitly below.
function parseCsv<T>(text: string): T[] {
  const res = Papa.parse<T>(text.trim(), {
    header: true, dynamicTyping: false, skipEmptyLines: true,
  })
  return res.data as T[]
}

// R writes missing values as the literal "NA"; PapaParse keeps that as a string.
// Coerce numeric fields to a real number or null so downstream math/formatting
// never sees a non-number (e.g. "NA".toFixed()).
const toNum = (v: unknown): number | null => {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '' || s === 'NA' || s === 'NaN' || s === 'NULL' || s === 'NA_real_') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
function coerceDeg(rows: DEGRow[]): DEGRow[] {
  for (const r of rows) {
    r.baseMean = toNum(r.baseMean) as number
    r.log2FoldChange = toNum(r.log2FoldChange) as number
    r.lfcSE = toNum(r.lfcSE)
    r.pvalue = toNum(r.pvalue)
    r.padj = toNum(r.padj)
  }
  return rows
}

// Enrichment tables are parsed as text too, so their numeric columns need the
// same explicit coercion the DEG table gets.
function coerceEnrichment(rows: EnrichmentRow[]): EnrichmentRow[] {
  for (const r of rows) {
    r.setSize = (toNum(r.setSize) ?? 0) as number
    r.count = (toNum(r.count) ?? 0) as number
    r.score = toNum(r.score)
    r.pvalue = toNum(r.pvalue)
    r.padj = toNum(r.padj)
  }
  return rows
}

// Counts can be large; parse by hand into a typed array for compact, fast lookup.
// Strip surrounding double-quotes (R's write.csv quotes character fields).
// Counts fields never contain embedded commas, so a plain split is safe here.
const unq = (s: string): string => {
  const t = s.trim()
  return t.length > 1 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1).replace(/""/g, '"') : t
}

function buildCounts(text: string): CountsMatrix {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',').map(unq)
  const hasName = /^(gene_name|symbol|name)$/i.test(header[1] ?? '')
  const sampleStart = hasName ? 2 : 1
  const samples = header.slice(sampleStart)
  const S = samples.length
  const N = lines.length - 1
  const geneIds = new Array<string>(N)
  const geneNames = new Array<string>(N)
  const values = new Float64Array(N * S)
  const index = new Map<string, number>()

  for (let i = 0; i < N; i++) {
    const cells = lines[i + 1].split(',')
    const id = unq(cells[0])
    const nm = hasName ? unq(cells[1] ?? '') : ''
    geneIds[i] = id
    geneNames[i] = nm
    const base = i * S
    for (let j = 0; j < S; j++) values[base + j] = +unq(cells[sampleStart + j]) || 0
    index.set(id.toUpperCase(), i)
    if (nm) index.set(nm.toUpperCase(), i)
  }
  return { geneIds, geneNames, samples, values, index }
}

/** Exported so the parsing rules can be tested without a browser. */
export async function assemble(read: Reader): Promise<Bundle> {
  const metaText = await read('meta.json')
  if (!metaText) throw new Error('meta.json not found in bundle')
  const meta = JSON.parse(metaText) as BundleMeta

  const samplesText = await read('samples.csv')
  if (!samplesText) throw new Error('samples.csv not found in bundle')
  const samples = parseCsv<SampleRow>(samplesText)

  const countsText = await read('normalized_counts.csv')
  if (!countsText) throw new Error('normalized_counts.csv not found in bundle')
  const counts = buildCounts(countsText)

  // Optional: enables running DESeq2 in-browser for pairs the pipeline skipped.
  const rawText = await read('raw_counts.csv')
  const rawCounts = rawText ? buildCounts(rawText) : undefined

  const degByContrast: Record<string, DEGRow[]> = {}
  const enrichmentByContrast: Record<string, EnrichmentRow[]> = {}
  for (const c of meta.contrasts) {
    const degText = await read(c.deg_file)
    if (degText) degByContrast[c.id] = coerceDeg(parseCsv<DEGRow>(degText))
    if (c.enrichment_file) {
      const eText = await read(c.enrichment_file)
      if (eText) enrichmentByContrast[c.id] = coerceEnrichment(parseCsv<EnrichmentRow>(eText))
    }
  }

  // Optional gene-set definitions for live ORA. Compact format: one row per set,
  // columns source,set_id,set_name,genes with genes "/"-joined.
  let genesets: GeneSetDef[] | undefined
  const gsText = await read('genesets.csv')
  if (gsText) {
    const rows = Papa.parse<{ source: string; set_id: string; set_name: string; genes: string }>(
      gsText.trim(), { header: true, skipEmptyLines: true }).data
    const list: GeneSetDef[] = []
    for (const r of rows) {
      if (!r.set_id || !r.genes) continue
      list.push({ source: r.source || '', id: r.set_id, name: r.set_name || r.set_id, genes: String(r.genes).split('/').filter(Boolean) })
    }
    if (list.length) genesets = list
  }

  return { meta, samples, counts, rawCounts, degByContrast, enrichmentByContrast, genesets }
}

// Load a bundle served under a base URL (e.g. the bundled sample, or a hosted dir).
export function loadBundleFromUrl(baseUrl: string): Promise<Bundle> {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  return assemble(async (name) => {
    const r = await fetch(base + name)
    return r.ok ? await r.text() : null
  })
}

// Load a bundle the user picked with a <input type="file" webkitdirectory> control.
export function loadBundleFromFiles(files: FileList | File[]): Promise<Bundle> {
  const map = new Map<string, File>()
  for (const f of Array.from(files)) {
    const base = ((f as any).webkitRelativePath || f.name).split('/').pop() as string
    map.set(base.toLowerCase(), f)
  }
  return assemble(async (name) => {
    const f = map.get(name.toLowerCase())
    return f ? await f.text() : null
  })
}

// Load a bundle from a .zip file (entries matched by basename, so a zipped
// folder or a flat zip both work). Decompressed entirely in the browser.
export async function loadBundleFromZip(file: File): Promise<Bundle> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(buf)
  const map = new Map<string, Uint8Array>()
  for (const path of Object.keys(entries)) {
    if (path.endsWith('/')) continue // directory entry
    if (path.includes('__MACOSX')) continue // macOS zip cruft
    const base = (path.split('/').pop() || '').toLowerCase()
    if (base && !map.has(base)) map.set(base, entries[path])
  }
  const dec = new TextDecoder()
  return assemble(async (name) => {
    const d = map.get(name.toLowerCase())
    return d ? dec.decode(d) : null
  })
}

// Per-gene normalized expression across samples, aligned to counts.samples order.
export function geneRow(counts: CountsMatrix, query: string): { row: number; values: number[] } | null {
  const i = counts.index.get(query.trim().toUpperCase())
  if (i === undefined) return null
  const S = counts.samples.length
  const base = i * S
  return { row: i, values: Array.from(counts.values.subarray(base, base + S)) }
}
