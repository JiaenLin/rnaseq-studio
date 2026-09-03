// The shared data space: datasets somebody has published, ready to open.
//
// WHERE THE DATA LIVES, and why this file is so small. A dataset is one .zip —
// the format the studio already reads and rnaseq-lab already emits — and a
// catalogue is a JSON file listing them. That is the whole storage design. The
// zips can sit in Vercel Blob, in an S3 bucket, in Cloudflare R2, in a GitHub
// release, or beside the app in `public/`; nothing here knows or cares, because
// every one of those serves an HTTPS URL and an HTTPS URL is all a dataset is.
//
// A database would buy queries this does not need. One JSON file cannot get out
// of step with itself, cannot be half-migrated, and can be edited by hand at
// three in the morning when something is wrong.
//
// WHERE THE CATALOGUE IS LOOKED FOR. `catalogue.json` beside the app, which is
// deliberately the dullest possible rule:
//
//   · deployed with the app     put the file in public/
//   · in a bucket               rewrite /catalogue.json to it in vercel.json
//   · listed dynamically        rewrite /catalogue.json to a function
//   · GitHub Pages              no such file -> 404 -> the panel hides itself
//
// So the same build serves the public studio, which has no data space, and a lab
// deployment that does. One repo, two deployments, no fork and no build flag —
// though VITE_CATALOGUE_URL overrides it for anyone who wants the file
// somewhere else.
//
// CROSS-ORIGIN. If the catalogue or the zips are served from another host, that
// host must send `Access-Control-Allow-Origin` — the studio has to READ these
// responses, not merely embed them, and cross-origin isolation does not change
// that. Serving them same-origin through a rewrite avoids the question entirely
// and is the recommended arrangement.

import type { Bundle } from '../types'
import { loadBundleFromZip } from './bundle.ts'

/** One published dataset. Every field but the first four is for choosing between them. */
export interface CatalogueEntry {
  /** Stable id. Used in the URL, so it must not change once published. */
  slug: string
  title: string
  /** Absolute, or relative to the catalogue's own URL. */
  url: string
  species: string
  description?: string
  /** Compressed size, so a click can say what it is about to cost. */
  bytes?: number
  samples?: number
  genes?: number
  conditions?: string[]
  /** Contrast labels, not ids — this is read by a person choosing. */
  contrasts?: string[]
  /** Who published it, and when. */
  source?: string
  published?: string
}

export interface Catalogue {
  name?: string
  updated?: string
  datasets: CatalogueEntry[]
}

export const catalogueUrl = (): string =>
  (import.meta.env?.VITE_CATALOGUE_URL as string | undefined)
  || `${import.meta.env?.BASE_URL ?? '/'}catalogue.json`

/**
 * What a catalogue must carry to be usable, checked rather than trusted.
 *
 * A hand-edited JSON file is the point of this design and also its risk: an
 * entry with no `url` renders a row that cannot be opened, and one with no
 * `slug` collides with the next one in React's key. Bad entries are DROPPED and
 * counted rather than thrown on, because one malformed row must not cost the
 * reader the other twenty.
 */
export function parseCatalogue(raw: unknown): { catalogue: Catalogue; dropped: number } {
  const src = raw as Partial<Catalogue> | CatalogueEntry[] | null
  // A bare array is the shape people write first. Accept it.
  const list = Array.isArray(src) ? src : Array.isArray(src?.datasets) ? src.datasets : []
  const seen = new Set<string>()
  const datasets: CatalogueEntry[] = []
  let dropped = 0
  for (const d of list) {
    const e = d as Partial<CatalogueEntry>
    if (!e || typeof e.slug !== 'string' || !e.slug.trim()
      || typeof e.url !== 'string' || !e.url.trim()
      || typeof e.title !== 'string' || !e.title.trim()
      || seen.has(e.slug)) { dropped++; continue }
    seen.add(e.slug)
    datasets.push({
      slug: e.slug.trim(), title: e.title.trim(), url: e.url.trim(),
      species: typeof e.species === 'string' ? e.species : 'unknown',
      description: str(e.description), bytes: num(e.bytes),
      samples: num(e.samples), genes: num(e.genes),
      conditions: strs(e.conditions), contrasts: strs(e.contrasts),
      source: str(e.source), published: str(e.published),
    })
  }
  return {
    catalogue: {
      name: str((src as Catalogue)?.name), updated: str((src as Catalogue)?.updated), datasets,
    },
    dropped,
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined

/**
 * Fetch and parse. `null` — not an error — when there is no catalogue here.
 *
 * A 404 is the ordinary case on a deployment without a data space, and it must
 * not surface as a failure anywhere: the panel simply does not exist there.
 */
export async function loadCatalogue(url = catalogueUrl()): Promise<{ catalogue: Catalogue; dropped: number } | null> {
  let res: Response
  try { res = await fetch(url) } catch { return null }
  if (!res.ok) return null
  let raw: unknown
  try { raw = await res.json() } catch { return null }
  const parsed = parseCatalogue(raw)
  // An empty catalogue is a configured data space with nothing in it yet, which
  // is worth saying; a file that parsed to nothing usable is not a data space.
  if (!parsed.catalogue.datasets.length && parsed.dropped) return null
  return parsed
}

/** Absolute URL for an entry, resolved against the catalogue it came from. */
export const entryUrl = (entry: CatalogueEntry, from = catalogueUrl()): string =>
  new URL(entry.url, new URL(from, location.href)).href

/**
 * One dataset, opened.
 *
 * Straight through `loadBundleFromZip`, which is the same path a reader's own
 * dropped file takes — so a published dataset and a local one are the same kind
 * of object by the time anything else sees them, and no view needs to know
 * which is which.
 */
export async function openDataset(entry: CatalogueEntry, from?: string): Promise<Bundle> {
  const url = entryUrl(entry, from)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch ${entry.title} — HTTP ${res.status}`)
  const blob = await res.blob()
  return loadBundleFromZip(new File([blob], `${entry.slug}.zip`, { type: 'application/zip' }))
}

/* ─────────────────────────────── choosing ─────────────────────────────── */

/**
 * Free-text search across everything a person might type.
 *
 * Conditions and contrast labels are searched as well as the title, because the
 * way somebody looks for a dataset is "the one with the cold-exposed knockouts",
 * and those words are in the design rather than in the name.
 */
export function searchDatasets(
  datasets: readonly CatalogueEntry[], query: string, species = 'all',
): CatalogueEntry[] {
  const q = query.trim().toLowerCase()
  const terms = q ? q.split(/\s+/) : []
  return datasets.filter(d => {
    if (species !== 'all' && d.species.toLowerCase() !== species.toLowerCase()) return false
    if (!terms.length) return true
    const hay = [d.title, d.description, d.source, d.species, d.slug,
      ...(d.conditions ?? []), ...(d.contrasts ?? [])].join(' ').toLowerCase()
    // Every term must appear somewhere — two words narrow rather than widen.
    return terms.every(t => hay.includes(t))
  })
}

/** The species present, for the filter chips. Never offers one nothing has. */
export const speciesIn = (datasets: readonly CatalogueEntry[]): string[] =>
  [...new Set(datasets.map(d => d.species).filter(Boolean))].sort()

export function formatBytes(n?: number): string {
  if (n == null) return ''
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
}
