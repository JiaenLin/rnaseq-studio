// The gene-set library, as the app consumes it.
//
// The library used to arrive with the data. A bundle carried genesets.csv,
// written by export-bundle.R, which meant whichever collections that one export
// happened to include, filtered to that one experiment's background — and a
// bundle exported without it could not run enrichment at all. Which collections
// a reader could test against was decided months earlier by whoever ran the
// pipeline, and nothing on screen said so.
//
// It is MSigDB now, per species, fetched on demand, plus the assembled
// Metabolic library. What is left here is the wiring: which collections are
// enabled, loading them, and folding them against the contrast to make the
// index ORA runs on. A bundle's own genesets.csv is still read and is offered
// as one more collection beside them — see `embeddedCollection`.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  indexFor, isLoaded, loadCollection, loadManifest,
  type Collection, type Manifest, type SetIndex,
} from './msigdb.ts'
import { detectSpecies, speciesOfMeta, type Detection, type Species } from './species.ts'

import type { GeneSetDef } from '../types'

export type { SetIndex } from './msigdb.ts'
export type { Collection } from './msigdb.ts'

export interface LibraryState {
  /** What each species offers, or null until the manifest lands. */
  manifest: Manifest | null
  /**
   * The enabled collections, once every one of them has arrived.
   *
   * Collections, not a folded index: the background an enrichment is tested
   * against is the genes THAT CONTRAST tested, which differs between contrasts
   * on one object, so folding belongs to the caller. rnaseq-studio splits it
   * the same way — one `prepareSets` per bundle, one background per contrast.
   */
  collections: Collection[]
  /** How many of the requested collections have arrived. */
  done: number
  total: number
  loading: boolean
  error: string | null
}

/** The sources a species starts with, from the manifest's own `on` flags. */
export function defaultSources(manifest: Manifest | null, species: Species): string[] {
  return manifest?.species[species]?.sources.filter(s => s.on).map(s => s.source) ?? []
}

/**
 * Load the enabled collections for a species and fold them against an object.
 *
 * Two costs, deliberately separated. The DOWNLOAD belongs to the species and
 * the collection — mouse GO:BP is the same 1.4 MB whatever object is open — so
 * it is cached for the life of the tab, and switching back to a source you had
 * a minute ago costs nothing. The INDEX belongs to the object, because it is
 * the object's own gene list that decides which sets survive and how large each
 * one is; it is rebuilt when the object or the enabled sources change, and
 * costs about 55 ms on the full human default library.
 */
export function useGeneSets(
  /** null before an object is open — nothing is fetched until then. */
  species: Species | null,
  sources: readonly string[],
  /**
   * Collections the reader supplied, from their own GMT files.
   *
   * They sit beside the MSigDB ones and are never fetched, so they survive a
   * species switch — a lab's own signatures are the lab's, not a property of
   * whichever object happens to be open.
   */
  custom: readonly Collection[] = EMPTY,
): LibraryState {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [done, setDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Only the newest request may land: switching species while three files are
  // in flight must not fold the old species' sets into the new index.
  const token = useRef(0)

  useEffect(() => {
    loadManifest().then(setManifest, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const wanted = useMemo(() => {
    if (!species) return []
    const avail = manifest?.species[species]?.sources ?? []
    return avail.filter(s => sources.includes(s.source))
  }, [manifest, species, sources])

  // The identity of the request, so the effect does not re-fire on a new array
  // that names the same files.
  const key = `${species}|${wanted.map(w => w.file).join(',')}`

  useEffect(() => {
    if (!manifest) return
    const mine = ++token.current
    setError(null)
    if (!wanted.length) { setCollections([]); setDone(0); return }
    // Anything already cached is not a download, so adding one source to a
    // library that is already in hand does not redraw the card as "loading".
    const already = wanted.filter(w => isLoaded(w.file)).length
    setDone(already)
    let landed = already
    Promise.all(wanted.map(w => {
      const fresh = !isLoaded(w.file)
      return loadCollection(w.file).then(c => {
        if (fresh && token.current === mine) setDone(++landed)
        return c
      })
    })).then(
      cs => { if (token.current === mine) { setCollections(cs); setDone(cs.length) } },
      (e: unknown) => {
        if (token.current === mine) setError(e instanceof Error ? e.message : String(e))
      },
    )
    // `key` is the identity of `wanted`; depending on the array itself would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, key])

  const ready = wanted.length > 0 && collections.length === wanted.length

  // A custom collection needs no download, so it is available while MSigDB is
  // still in flight and remains available if MSigDB fails to load at all.
  const all = useMemo(
    () => (custom.length ? [...(ready ? collections : []), ...custom] : (ready ? collections : EMPTY)),
    [ready, collections, custom])

  return {
    manifest,
    collections: all,
    done,
    total: wanted.length,
    loading: wanted.length > 0 && !ready && !error,
    error,
  }
}

/** One frozen empty array, so a not-ready library is referentially stable. */
const EMPTY: Collection[] = []

/**
 * Fold the loaded collections against one contrast's tested genes.
 *
 * Separate from the hook because the background is per contrast, and memoised
 * on its own because folding the full human default library costs about 50 ms
 * and must not repeat on a threshold drag.
 */
export function useSetIndex(collections: Collection[], background: string[]): SetIndex | null {
  return useMemo(
    () => (collections.length ? indexFor(collections, background) : null),
    [collections, background])
}

/* ---------------------------------------------------------------------------
   The library, as one thing the whole app shares.
--------------------------------------------------------------------------- */

/**
 * The bundle's own genesets.csv, as a collection like any other.
 *
 * It used to be the whole library — export-bundle.R wrote five collections for
 * Homo sapiens filtered to that experiment's background, and a bundle exported
 * without it could not run enrichment at all. It is now one source among two
 * dozen, which is the right relationship: it is this experiment's export, and
 * MSigDB is the database. Named for the bundle so it cannot be mistaken for one
 * of the shipped collections.
 */
export function embeddedCollection(defs: GeneSetDef[] | undefined, project: string): Collection[] {
  if (!defs?.length) return EMPTY
  const at = new Map<string, number>()
  const symbols: string[] = []
  const sets = defs.map(d => ({
    id: d.id,
    name: d.name || d.id,
    genes: Int32Array.from(d.genes.map(g => {
      let k = at.get(g)
      if (k === undefined) { k = symbols.length; at.set(g, k); symbols.push(g) }
      return k
    })),
  }))
  return [{
    species: 'any', source: 'From this bundle', release: project || 'this export',
    symbols, sets,
  }]
}

/** Everything the gene-set tabs need, owned once. */
export interface LibraryControl {
  lib: LibraryState
  species: Species
  /** Which evidence chose it, and the sentence saying so. */
  origin: 'you' | 'accession' | 'recorded' | 'names' | 'default'
  why: string
  /**
   * True when the accessions say one species and meta.json says the other.
   *
   * Worth surfacing rather than resolving silently: one of the two is wrong
   * about the bundle, and which one it is decides whether the reader should fix
   * their metadata or their pipeline.
   */
  conflict: boolean
  onSpecies: (s: Species) => void
  sources: string[]
  onSources: (next: string[]) => void
  customSets: Collection[]
  onCustomSets: (next: Collection[]) => void
  /** What the bundle's own gene names say, for the species check. */
  detected: Detection
  /** What the bundle RECORDED, if it recorded anything. */
  recorded: Species | null
}

/**
 * One library for the whole app, not one per tab.
 *
 * Enrichment owned all of this — species, enabled collections, the reader's own
 * pasted sets — which had two consequences and both were bad. Gene sets could
 * not reach MSigDB at all, so the one tab whose whole subject is gene sets was
 * the one tab that had none; and a reader who pasted their signatures for the
 * enrichment test had to paste them again to score them per sample, into a
 * control that produced something the rest of the app could not see.
 *
 * So it is here, beside `geneText`, which lives in App for exactly the same
 * reason: switching tabs must not discard what somebody typed.
 *
 * @param genes  the genes this contrast tested — the background, and the
 *               evidence species detection runs on
 */
export function useLibrary({ genes, ids = EMPTY_SOURCES, metaSpecies, embedded = EMPTY, bundleKey = '' }: {
  genes: string[]
  /**
   * The accession column, when the object is displayed by symbol.
   *
   * `detectSpecies` has always taken this and App has never passed it, which
   * quietly reduced detection to the casing vote — its weakest signal. A mouse
   * bundle of ENSMUSG accessions whose exporter upper-cased its symbols was
   * read as human at 100% confidence, and if meta.json did not record a species
   * the library opened on the wrong one. The evidence was in the bundle the
   * whole time.
   */
  ids?: string[]
  metaSpecies: string | undefined
  embedded?: Collection[]
  /**
   * Changes when a different bundle is opened — see the reset below.
   */
  bundleKey?: string
}): LibraryControl {
  const detected = useMemo(() => detectSpecies(genes, ids), [genes, ids])
  const recorded = useMemo(() => speciesOfMeta(metaSpecies), [metaSpecies])

  /**
   * Which species' library to test against.
   *
   * The bundle's own meta.species is read first — it is what the lab recorded,
   * and better evidence than anything inferable from the gene list. Detection
   * from the gene names is the fallback for a bundle that left it blank, and
   * the reader can override either.
   */
  const [pick, setPick] = useState<Species | null>(null)

  /**
   * An ENSMUSG accession beats meta.json, and nothing else does.
   *
   * `recorded` used to win outright, on the reasoning that it is what the lab
   * wrote down and better evidence than anything inferable from a gene list.
   * That reasoning holds against the casing vote and not against an accession:
   * ENSMUSG is not inferred from the identifier, it IS the identifier, while
   * meta.species is free text somebody typed once. A bundle whose metadata says
   * human and whose every gene is ENSMUSG is a bundle with a typo in one field,
   * and opening the human library for it is the one case auto-detection exists
   * to prevent.
   */
  const auto = detected.from === 'accession' ? detected.species : (recorded ?? detected.species)
  const species = pick ?? auto
  const conflict = detected.from === 'accession' && recorded != null && recorded !== detected.species

  /**
   * `null` until the defaults land — which is NOT the same as the empty array.
   *
   * The distinction is load-bearing. The effect below fills in the species'
   * default collections while nothing has been chosen, and it used to test
   * `sources.length`, so "the reader has turned every collection off" and "the
   * reader has not chosen yet" were one state. Somebody who had pasted their
   * own sets and switched the last MSigDB collection off — which the chips now
   * allow, because their own library is not empty — watched all seven snap
   * straight back on, once per click, with nothing on screen explaining it.
   *
   * `null` means undecided and `[]` means decided on none, so the effect fires
   * exactly once.
   */
  const [chosen, setChosen] = useState<string[] | null>(null)

  /**
   * A new bundle re-asks the question. Every answer to the old one is retired.
   *
   * `pick` is an override made about ONE object and it used to outlive it: pick
   * Mouse on an unlabelled bundle, open a bundle that records human, and the
   * human bundle opened on the mouse library — with "this bundle records human"
   * printed beside a select reading Mouse, the app disagreeing with itself on
   * one line. `chosen` goes with it because a species change invalidates it
   * anyway, and the collections are per analysis.
   *
   * `customSets` deliberately survives: a lab's own signatures are the lab's,
   * not a property of whichever object happens to be open.
   *
   * Adjusted during render rather than in an effect, which is React's own
   * remedy for exactly this — the alternative renders the wrong species once
   * and then corrects it, and a species flash is a download.
   */
  const [seenKey, setSeenKey] = useState(bundleKey)
  if (bundleKey !== seenKey) {
    setSeenKey(bundleKey)
    setPick(null)
    setChosen(null)
  }
  const sources = chosen ?? EMPTY_SOURCES
  const [customSets, onCustomSets] = useState<Collection[]>([])

  const all = useMemo(
    () => (embedded.length ? [...customSets, ...embedded] : embedded.length ? embedded : customSets),
    [customSets, embedded])
  const lib = useGeneSets(species, sources, all)

  // The species' own defaults, once the manifest says what it has. Set even
  // when the species offers none, so this settles rather than re-running.
  useEffect(() => {
    if (!lib.manifest || chosen !== null) return
    setChosen(defaultSources(lib.manifest, species))
  }, [lib.manifest, species, chosen])

  /**
   * A species switch re-asks the question, because the answer differs.
   *
   * The collections are not the same on both sides — mouse has no native KEGG
   * and no human phenotype ontology — so carrying a human selection over to
   * mouse silently drops the ones that do not exist there and leaves the reader
   * with fewer collections than either species offers by default.
   */
  const onSpecies = (next: Species) => { setPick(next); setChosen(null) }

  const origin: LibraryControl['origin'] = pick ? 'you'
    : detected.from === 'accession' ? 'accession'
      : recorded ? 'recorded'
        : detected.from === 'symbols' ? 'names' : 'default'

  const why = origin === 'you' ? 'you chose this library'
    : origin === 'accession' ? detected.why
      : origin === 'recorded' ? `this bundle records ${metaSpecies}`
        : origin === 'names' ? `not recorded in the bundle; ${detected.why}`
          : 'not recorded, and the gene names say nothing either way'

  return {
    lib, species, origin, why, conflict, onSpecies, sources, onSources: setChosen,
    customSets, onCustomSets, detected, recorded,
  }
}

/** One frozen empty array, so "chosen nothing" is referentially stable. */
const EMPTY_SOURCES: string[] = []
