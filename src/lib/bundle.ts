import Papa from 'papaparse'
import type {
  Bundle, BundleMeta, SampleRow, DEGRow, EnrichmentRow, CountsMatrix, GeneSetDef,
} from '../types'

// A Reader resolves a file name within a bundle to its text, or null if absent.
export type Reader = (name: string) => Promise<string | null>

function parseCsv<T>(text: string): T[] {
  const res = Papa.parse<T>(text.trim(), {
    header: true, dynamicTyping: true, skipEmptyLines: true,
  })
  return res.data as T[]
}

// Counts can be large; parse by hand into a typed array for compact, fast lookup.
function buildCounts(text: string): CountsMatrix {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',')
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
    const id = cells[0]
    const nm = hasName ? (cells[1] ?? '') : ''
    geneIds[i] = id
    geneNames[i] = nm
    const base = i * S
    for (let j = 0; j < S; j++) values[base + j] = +cells[sampleStart + j] || 0
    index.set(id.toUpperCase(), i)
    if (nm) index.set(nm.toUpperCase(), i)
  }
  return { geneIds, geneNames, samples, values, index }
}

async function assemble(read: Reader): Promise<Bundle> {
  const metaText = await read('meta.json')
  if (!metaText) throw new Error('meta.json not found in bundle')
  const meta = JSON.parse(metaText) as BundleMeta

  const samplesText = await read('samples.csv')
  if (!samplesText) throw new Error('samples.csv not found in bundle')
  const samples = parseCsv<SampleRow>(samplesText)

  const countsText = await read('normalized_counts.csv')
  if (!countsText) throw new Error('normalized_counts.csv not found in bundle')
  const counts = buildCounts(countsText)

  const degByContrast: Record<string, DEGRow[]> = {}
  const enrichmentByContrast: Record<string, EnrichmentRow[]> = {}
  for (const c of meta.contrasts) {
    const degText = await read(c.deg_file)
    if (degText) degByContrast[c.id] = parseCsv<DEGRow>(degText)
    if (c.enrichment_file) {
      const eText = await read(c.enrichment_file)
      if (eText) enrichmentByContrast[c.id] = parseCsv<EnrichmentRow>(eText)
    }
  }

  // Optional gene-set definitions (long format) for live ORA. Grouped by set_id.
  let genesets: GeneSetDef[] | undefined
  const gsText = await read('genesets.csv')
  if (gsText) {
    const rows = Papa.parse<{ source: string; set_id: string; set_name: string; gene: string }>(
      gsText.trim(), { header: true, skipEmptyLines: true }).data
    const map = new Map<string, GeneSetDef>()
    for (const r of rows) {
      if (!r.set_id || !r.gene) continue
      let g = map.get(r.set_id)
      if (!g) { g = { source: r.source || '', id: r.set_id, name: r.set_name || r.set_id, genes: [] }; map.set(r.set_id, g) }
      g.genes.push(String(r.gene))
    }
    if (map.size) genesets = [...map.values()]
  }

  return { meta, samples, counts, degByContrast, enrichmentByContrast, genesets }
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

// Per-gene normalized expression across samples, aligned to counts.samples order.
export function geneRow(counts: CountsMatrix, query: string): { row: number; values: number[] } | null {
  const i = counts.index.get(query.trim().toUpperCase())
  if (i === undefined) return null
  const S = counts.samples.length
  const base = i * S
  return { row: i, values: Array.from(counts.values.subarray(base, base + S)) }
}
