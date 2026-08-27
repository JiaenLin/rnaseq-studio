import { useMemo, useState } from 'react'
import type { LibraryControl, LibraryState, SetIndex } from '../lib/genesets.ts'
import { collectionToText, type Collection } from '../lib/msigdb.ts'
import SetEditor from './SetEditor.tsx'
import { matchRate, type Detection, type Species } from '../lib/species.ts'

/**
 * Which MSigDB collections are in play, and what state the library is in.
 *
 * The collections are a parameter of the analysis, like the thresholds beside
 * them — turning GO:BP off changes what is tested and therefore what the
 * Benjamini–Hochberg correction is applied across — so they live on the card
 * that runs the test, not in the app's own bar. The SPECIES does live on that
 * card's header, because it is a fact about the bundle rather than a choice
 * about the analysis.
 *
 * A collection that is off has not been downloaded. Its size is on the chip, so
 * the cost of turning it on is stated before it is paid rather than discovered
 * as a pause.
 */
export default function GeneSetSources({
  lib, species, sources, onSources, customSets, onCustomSets, index, background, detected,
}: {
  lib: LibraryState
  species: Species
  sources: readonly string[]
  onSources: (next: string[]) => void
  /** Collections the reader supplied themselves. */
  customSets: readonly Collection[]
  onCustomSets: (next: Collection[]) => void
  /**
   * The library folded against a background, when the caller has one.
   *
   * Enrichment does — it is what its test runs on — and the count of sets that
   * survived is the honest headline: 12 599 sets in the collection is not the
   * number anything was tested against.
   */
  index?: SetIndex | null
  /** The genes this contrast tested, for the coverage figure below. */
  background: readonly string[]
  /** What the bundle's own gene names say it is, for the species check. */
  detected: Detection | null
}) {
  const avail = lib.manifest?.species[species]?.sources ?? []
  /** The editor: closed, open on nothing, or open on a collection being edited. */
  const [edit, setEdit] = useState<{ of: Collection | null } | null>(null)

  /**
   * How much of this bundle any enabled set covers.
   *
   * This is COVERAGE, and it used to be presented as a species check — "only
   * 12.5% of this bundle's genes are spelled the way the Mouse library spells
   * them", on a bundle that is unmistakably mouse. It was measuring the wrong
   * thing entirely: with Hallmark alone enabled the library holds 4 291 symbols
   * and the bundle tested 34 290, so 12.5% is arithmetic, not a diagnosis.
   * Turn on the six default collections and the same bundle reads 58.8%.
   *
   * Which species the sets are for is a different question with a better
   * answer, one line down: the bundle's own names already settle it.
   */
  const covered = useMemo(() => {
    if (!lib.collections.length) return null
    const syms = new Set<string>()
    for (const c of lib.collections) for (const g of c.symbols) syms.add(g.toUpperCase())
    if (!background.length) return null
    let hit = 0
    for (const g of background) if (syms.has(g.toUpperCase())) hit++
    return hit / background.length
  }, [lib.collections, background])

  /**
   * The species check that is actually a species check.
   *
   * Not a ratio: a disagreement between what the reader has chosen and what the
   * bundle's own gene names say. On the bundle that prompted this, detection
   * read ENSMUSG accessions at 100% confidence while a coverage ratio was
   * calling it 12.5% — one of those is evidence about a species and the other
   * is evidence about a collection.
   *
   * Only raised when detection had something real to go on. A bundle whose
   * symbols were upper-cased upstream genuinely looks human, and shouting at
   * someone who has correctly overridden that is worse than staying quiet.
   */
  /**
   * Does this bundle SPELL genes the way this library spells them?
   *
   * `covered` above ignores case, because ORA does — it has to, exporters vary.
   * That is what makes it useless for this question: a mouse object run against
   * the human library still matches 96% of its genes case-insensitively. This
   * one is case-SENSITIVE, which is the whole point: Gfap is mouse MSigDB's
   * spelling and GFAP is human's, so comparing exactly separates the two
   * libraries where comparing loosely cannot.
   *
   * `matchRate` was written for this, documented at length, and called from
   * nowhere. What ran instead was a guess from casing that told a mouse bundle
   * with upper-cased symbols it "looks like human" and that its results "will
   * be answering a question about a different species" — which was false, and
   * is the sentence that has been read as this app shipping human gene sets
   * under a mouse label.
   */
  const spelling = useMemo(() => {
    if (!lib.collections.length || !background.length) return null
    const exactSyms = new Set<string>()
    for (const c of lib.collections) for (const g of c.symbols) exactSyms.add(g)
    return { exact: matchRate(background, exactSyms), example: exampleSymbol(lib.collections) }
  }, [lib.collections, background])

  /**
   * Two different problems, told apart by the two rates.
   *
   * Casing only — the loose rate is healthy and the exact one is not — means the
   * library is right and the spelling differs, which changes nothing about the
   * answer because matching ignores case. Saying that plainly is the opposite
   * of the old warning, which raised an alarm about the species.
   *
   * Both low means the genes are not in this library however they are spelled,
   * and THAT is when the species is worth doubting.
   */
  const loose = covered ?? 0
  const casingOnly = !!spelling && loose > 0.35 && spelling.exact < loose * 0.5
  const notThisLibrary = !!spelling && loose <= 0.35 && background.length > 200

  const wrongSpecies = detected
    && detected.species !== species
    && (detected.from === 'accession' || (detected.from === 'symbols' && detected.support > 0.8))

  /**
   * The last collection standing, which may not be switched off.
   *
   * Never all off: the card below would have nothing to test against and the
   * only way back would be this row, which is easy to scroll past.
   *
   * A collection of the reader's OWN counts as one standing — somebody who has
   * just pasted their own sets and wants to test against those alone is not
   * asking for an empty library, and the guard has no business stopping them.
   */
  const lastStanding = (name: string) =>
    sources.length === 1 && sources[0] === name && customSets.length === 0

  const toggle = (name: string) => {
    const on = sources.includes(name)
    if (on && lastStanding(name)) return
    onSources(on ? sources.filter(s => s !== name) : [...sources, name])
  }

  const chosen = avail.filter(s => sources.includes(s.source))
  const nSets = chosen.reduce((a, s) => a + s.nSets, 0)
  /** Sets the reader brought. Always on — they are not downloaded, they are given. */
  const mine = customSets.reduce((a, c) => a + c.sets.length, 0)

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Collections
        </span>
        {avail.map(s => {
          const on = sources.includes(s.source)
          return (
            <button
              key={s.source} aria-pressed={on}
              className={`pill pressable border ${on
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700'}
                ${lastStanding(s.source) ? 'cursor-not-allowed opacity-70' : ''}`}
              // Says no rather than doing nothing. A chip that silently ignores
              // the click is indistinguishable from one that is broken.
              disabled={lastStanding(s.source)}
              title={lastStanding(s.source)
                ? 'The only collection left — turn another on, or add your own, before turning this off'
                : `${s.nSets.toLocaleString()} sets · ${(s.bytes / 1e6).toFixed(2)} MB`
                + (s.note ? ` · ${s.note}` : '')
                + (s.projected ? ' · human sets mapped through orthologs, not a mouse annotation' : '')
                + (s.derived ? ` · assembled from ${s.derived.join(', ')}` : '')
                + (on ? '' : ' — not downloaded yet')}
              onClick={() => toggle(s.source)}
            >
              {s.source}
              <span className="ml-1.5 opacity-60">{s.nSets.toLocaleString()}</span>
            </button>
          )
        })}
      </div>

      {/*
        The reader's own sets, on a row of their own.

        They used to sit at the end of the MSigDB row, and so did the button
        that makes them — which put an ACTION at the end of a wrap-flow of
        FILTERS. With two dozen collections that button lands wherever the row
        happens to break, three lines down, indistinguishable from a
        twenty-fifth database nobody has heard of.

        A labelled row instead, shown whether or not anything is in it, so the
        one thing a lab with its own signatures needs is visible before they go
        looking for it rather than after.
      */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-slate-200 pt-2.5 dark:border-slate-700">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Your sets
        </span>

        {/* A button, not a file picker.
            "Add a GMT…" asked the reader to go and produce a file in a format
            they do not work in — nobody keeps their signatures as
            tab-separated triples, they keep them as the dict they built the
            analysis with. The editor takes that dict, and reading a file is
            still offered inside it. */}
        <button className="btn py-0.5 text-xs" onClick={() => setEdit({ of: null })}>
          + Paste or upload
        </button>

        {customSets.map(c => (
          // Two targets, because they are two different acts. Clicking the name
          // used to REMOVE the collection — a destructive action on the whole
          // chip, one stray click from losing a paste with no way back, and no
          // way at all to change a set once added. The name opens it for
          // editing now; the × is its own button and says so.
          <span key={c.source}
            className="pill border border-emerald-300 bg-emerald-50 p-0 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
            <button
              className="pressable rounded-l-full py-0.5 pl-2 pr-1"
              title={`${c.sets.length.toLocaleString()} of your sets — click to edit them`}
              onClick={() => setEdit({ of: c })}
            >
              {c.source}
              <span className="ml-1.5 opacity-70">{c.sets.length.toLocaleString()}</span>
            </button>
            <button
              className="pressable rounded-r-full py-0.5 pl-1 pr-2 opacity-70 hover:opacity-100"
              aria-label={`Remove ${c.source}`} title={`Remove ${c.source}`}
              onClick={() => onCustomSets(customSets.filter(x => x.source !== c.source))}
            >×</button>
          </span>
        ))}

        {!customSets.length && (
          <span className="text-xs text-slate-400">
            Paste a Python dict, a GMT, or one{' '}
            <span className="font-mono">Name: a, b, c</span> per line. They are tested and
            corrected exactly as MSigDB&rsquo;s are.
          </span>
        )}
      </div>

      <SetEditor
        open={edit !== null} background={background}
        initial={edit?.of ? { name: edit.of.source, text: collectionToText(edit.of) } : null}
        onClose={() => setEdit(null)}
        onAdd={c => {
          // Same name replaces rather than duplicates, so editing a set and
          // adding it again does not leave the old version enabled beside it.
          // Renaming while editing therefore ADDS: the old name is still a
          // collection somebody chose, and silently dropping it because a field
          // changed would be the destructive click this control just lost.
          onCustomSets([...customSets.filter(x => x.source !== c.source), c])
        }}
      />

      <p className="mt-2 text-xs text-slate-400">
        {lib.error
          ? <span className="text-amber-600 dark:text-amber-400">Could not load the gene sets — {lib.error}</span>
          : lib.loading
            ? `Loading ${lib.total - lib.done} of ${lib.total} collection${lib.total === 1 ? '' : 's'}…`
            : !chosen.length
              ? (customSets.length
                // "No collection selected" was counting MSigDB and nothing
                // else, so a reader who had turned every MSigDB collection off
                // in order to test against their OWN sets was told there was
                // nothing selected while their sets sat enabled beside the
                // sentence.
                ? <>Your own sets only — <b>{mine.toLocaleString()}</b> set{mine === 1 ? '' : 's'} in{' '}
                  {customSets.length} collection{customSets.length === 1 ? '' : 's'}. No MSigDB
                  collection is on, so nothing else is tested or corrected across.</>
                : 'No collection selected.')
              : index
                ? <>
                  MSigDB {index.release} · {nSets.toLocaleString()} sets, of which{' '}
                  <b>{index.sets.length.toLocaleString()}</b> contain a gene this contrast
                  tested. Those are the ones tested, and the ones corrected across.
                </>
                : <>MSigDB · {nSets.toLocaleString()} sets in {chosen.length} collection
                  {chosen.length === 1 ? '' : 's'}
                  {mine > 0 && <>, and {mine.toLocaleString()} of your own</>}.</>}
      </p>

      {covered !== null && (
        <p className="mt-1 text-xs text-slate-400">
          These collections annotate {(covered * 100).toFixed(0)}% of the genes this contrast
          tested. That fraction is the annotated background, and turning more collections on
          raises it.
        </p>
      )}

      {/*
        An assembled collection says what it was assembled FROM, and what
        having it on beside those costs.

        Without the first sentence "Metabolic" sits in that row looking like a
        database beside KEGG and Reactome, and a hit in it reads as a second,
        independent line of evidence for a pathway one of them already carries.
        Without the second, the reader is not told that the overlap is now
        tested twice — which is the price of the collection being a collection
        rather than a fold of the others, and not a price to charge silently.
      */}
      {chosen.filter(s => s.derived?.length).map(s => {
        // Only the parents actually switched on can be double-tested. A parent
        // that is off contributes nothing to overlap with, so naming it here
        // would be a warning about a thing that is not happening.
        const overlapping = s.derived!.filter(name => sources.includes(name))
        return (
          <p key={s.source} className="mt-1 text-xs text-slate-400">
            <b>{s.source}</b> is a metabolic library assembled from {s.derived!.join(', ')} —{' '}
            {s.nSets.toLocaleString()} sets under their own ids, so they are tested whatever
            else is enabled.
            {overlapping.length > 0 && (
              <>
                {' '}
                <span className="text-amber-600 dark:text-amber-400">
                  {overlapping.join(', ')} {overlapping.length === 1 ? 'is' : 'are'} on as well,
                  so a term in both is tested twice and corrected across twice.
                </span>{' '}
                Switch {overlapping.length === 1 ? 'it' : 'them'} off to test metabolism alone.
              </>
            )}
          </p>
        )
      })}

      {chosen.some(s => s.projected) && (
        <p className="mt-1 text-xs text-slate-400">
          {chosen.filter(s => s.projected).map(s => s.source).join(', ')} is human sets mapped
          through orthologs, not a {lib.manifest?.species[species]?.label.toLowerCase() ?? species}{' '}
          annotation — MSigDB publishes no native one. Read it as a weaker claim than the rest.
        </p>
      )}

      {/* Ordered by how bad it is. A bundle can be in the wrong library, or in
          the right one spelled differently, and those used to share a sentence
          whose conclusion only fitted the first. */}
      {notThisLibrary && spelling ? (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          <b>Only {(loose * 100).toFixed(0)}% of this bundle&rsquo;s genes are in the{' '}
            {lib.manifest?.species[species]?.label ?? species} library at all</b>, however they are
          spelled{detected ? ` — and ${detected.why}` : ''}. That usually means the wrong species is
          selected above, or that these are accessions rather than symbols.
        </p>
      ) : casingOnly && spelling ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Your genes are spelled <b>{detected?.species === 'human' ? 'GFAP' : 'Gfap'}</b>-style and
          this library spells them <b>{spelling.example}</b>-style
          — {(spelling.exact * 100).toFixed(0)}% match exactly, {(loose * 100).toFixed(0)}% ignoring
          case. <b>Matching ignores case, so the results below are this library&rsquo;s annotation</b>
          {' '}and nothing is lost. Switch the species above only if the data really is the other one.
        </p>
      ) : wrongSpecies && detected ? (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          <b>Your gene names look {detected.species}</b> — {detected.why} — but the{' '}
          {lib.manifest?.species[species]?.label ?? species} library is selected. Matching ignores
          case, so results will still appear; if the species is genuinely wrong they will be
          answering a question about a different organism.
        </p>
      ) : null}
    </div>
  )
}

/**
 * One symbol from the loaded library, chosen to show its casing.
 *
 * A real gene rather than a made-up "Gfap": the reader is being told what THIS
 * library holds, and a placeholder would be a claim about it rather than a
 * sample of it. Two letters minimum and no digits, because "AI597479" and
 * "2900092N22Rik" are real mouse symbols that say nothing about case.
 */
function exampleSymbol(collections: readonly Collection[]): string | null {
  for (const c of collections) {
    for (const g of c.symbols) if (/^[A-Za-z]{3,8}$/.test(g)) return g
  }
  return null
}

/**
 * The whole "which library" control: the species, then the collections.
 *
 * One component because it is one decision, and because two tabs now make it.
 * The species sits above the collections rather than inside them because it is
 * a fact about the bundle — human or mouse — while the collections are a choice
 * about the analysis. Getting the species wrong invalidates every collection
 * below it, so it is read first.
 */
export function LibraryPicker({ library, index, background, recorded }: {
  library: LibraryControl
  index?: SetIndex | null
  background: readonly string[]
  /** meta.species as the bundle spells it, for the sentence beside the select. */
  recorded?: string
}) {
  const { lib, species, origin, why, conflict, onSpecies, sources, onSources,
    customSets, onCustomSets, detected } = library
  const libExample = useMemo(() => exampleSymbol(lib.collections), [lib.collections])
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-100 pb-3 text-xs dark:border-slate-800">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Species</span>
        <select
          className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 dark:border-slate-700"
          value={species} aria-label="Gene set species"
          onChange={e => onSpecies(e.target.value as Species)}
        >
          <option value="human">Human</option>
          <option value="mouse">Mouse</option>
        </select>
        {/* Which evidence chose it. The select is pre-set from the bundle, so
            the one thing it must never be is silent about why — a reader who
            disagrees needs to know what the guess was based on before they
            override it. */}
        <span className={origin === 'default' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}>
          {why}
          {origin === 'accession' && !conflict && <> — so this was selected for you</>}
          {/* Said once, permanently, rather than only when something is wrong.
              "Are these human gene sets?" is a fair question to have about a
              library you cannot see, and one example symbol answers it at a
              glance — Gfap or GFAP, there is no third option. */}
          {libExample && <> · these sets spell genes <b className="font-semibold">{libExample}</b>-style</>}
        </span>
      </div>
      {conflict && (
        <p className="-mt-1.5 mb-3 text-xs text-amber-600 dark:text-amber-400">
          <b>This bundle disagrees with itself.</b> Its metadata records{' '}
          {recorded ?? library.recorded} and its accessions are{' '}
          {detected.species === 'mouse' ? 'ENSMUSG' : 'ENSG'}. The accessions decide it — they are
          the identifier rather than a field somebody typed — so the{' '}
          {lib.manifest?.species[species]?.label ?? species} library is loaded. Override above if
          that is wrong, and fix <code className="font-mono">meta.species</code> in the bundle.
        </p>
      )}
      <GeneSetSources
        lib={lib} species={species} sources={sources} onSources={onSources}
        customSets={customSets} onCustomSets={onCustomSets}
        index={index} background={background} detected={detected}
      />
    </>
  )
}
