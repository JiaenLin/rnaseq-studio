import { useCallback, useMemo, useRef, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from './types'
import type { GroupSel } from './lib/design'
import { defaultSelection, emptySel, sideLabel } from './lib/design'
import { computedContrastId, countSignificant, runDESeq2 } from './lib/deseq'
import { auditBundle, comparisonKey, comparisonState } from './lib/contrast'
import ComparisonBar from './components/ComparisonBar'
import { loadBundleFromUrl, loadBundleFromFiles, loadBundleFromZip } from './lib/bundle'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { embeddedCollection, useLibrary } from './lib/genesets'
import Overview from './components/Overview'
import GeneExpression from './components/GeneExpression'
import GeneSetExplorer from './components/GeneSetExplorer'
import Volcano from './components/Volcano'
import DEGTable from './components/DEGTable'
import Enrichment from './components/Enrichment'
import Methods from './components/Methods'

const DOI_URL = 'https://doi.org/10.5281/zenodo.21514152'
// The two upstream apps that produce a bundle, by what the user already has.
const LAB_URL = 'https://jiaenlin.github.io/rnaseq-lab/'
const SERVICE_URL = 'https://jiaenlin.github.io/rnaseq-service/'
const CITATION = 'Lin, J. (2026). RNA-seq Studio: a privacy-preserving, client-side interactive explorer for bulk RNA-seq results (v1.0.0). Zenodo. https://doi.org/10.5281/zenodo.21514152'

type Tab = 'overview' | 'expression' | 'volcano' | 'degs' | 'enrichment' | 'geneset' | 'methods'
// Ordered the way results are read: what the dataset is, then the statistics,
// then the pathway view, then drilling into genes, then writing it up.
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'degs', label: 'DEG table' },
  { id: 'volcano', label: 'Volcano' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'expression', label: 'Gene expression' },
  { id: 'geneset', label: 'Gene sets' },
  { id: 'methods', label: 'Methods' },
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * THE selection: both sides of the comparison, the arms merely shown, and the
   * samples switched off.
   *
   * The reader picks the sides freely. Whether the pipeline happened to export
   * that pair is a property of the answer, reported by `comparisonState`, not a
   * menu the question has to be chosen from — see lib/design.ts.
   */
  const [sel, setSel] = useState<GroupSel>(emptySel)
  const [tab, setTab] = useState<Tab>('overview')
  const [gene, setGene] = useState<string | null>(null)
  // Held here, not in the tab, so switching tabs or comparisons never discards
  // a typed gene list.
  const [geneText, setGeneText] = useState('')
  // DESeq2 results computed this session, keyed by "<numerator>|<denominator>".
  const [computed, setComputed] = useState<Record<string, DEGRow[]>>({})
  /**
   * The run, and which pair it belongs to.
   *
   * `runLog` used to be one string for the whole app and was never cleared, so
   * a failure on one pair rendered underneath a successful result for another —
   * visible in the report that prompted this as a red "needs at least 2
   * replicates" under a green "1 DEGs · from your pipeline". Keyed by pair now,
   * and read only when it matches the comparison on screen.
   */
  const [run, setRun] = useState<{ pair: string; running: boolean; log: string }>(
    { pair: '', running: false, log: '' })
  const [showHelp, setShowHelp] = useState(false)
  const [showStart, setShowStart] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const adopt = useCallback((b: Bundle) => {
    setBundle(b)
    // The comparison is chosen from what the bundle can actually offer, not
    // from meta.contrasts[0] alone — a bundle that exported no contrast at all
    // still opens on a pair it could compute rather than on nothing.
    setSel(defaultSelection(b.meta, b.meta.contrasts.find(c => c.kind !== 'interaction')))
    setRun({ pair: '', running: false, log: '' })
    setGene(null)
    setGeneText('')
    setTab('overview')
    setError(null)
  }, [])

  /**
   * Choosing a comparison is one assignment.
   *
   * Everything else — the reference, the arm on top, which DEG table the tabs
   * read, what the header says — is derived from it below. There is nothing
   * here that can fall out of step, because there is nothing else to write.
   */
  /** Any change to the selection retires a failure that belonged to the old pair. */
  const pickSel = (next: GroupSel) => {
    setSel(next)
    setRun(r => (r.running ? r : { pair: '', running: false, log: '' }))
  }

  // Deliberately NOT auto-loaded: a dataset already on screen at first paint
  // reads as "your data", and every number on it is someone else's.
  const loadDemo = useCallback(() => {
    setLoading(true)
    loadBundleFromUrl(`${import.meta.env.BASE_URL}sample/`)
      .then(adopt)
      .catch(e => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [adopt])

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setLoading(true)
    try { adopt(await loadBundleFromFiles(files)) }
    catch (e: any) { setError(String(e?.message || e)) }
    finally { setLoading(false) }
  }

  const loadZip = async (f: File) => {
    setLoading(true)
    try { adopt(await loadBundleFromZip(f)) }
    catch (e: any) { setError(`Could not read ${f.name}: ${e?.message || e}`) }
    finally { setLoading(false) }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const zip = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.zip'))
    if (zip) loadZip(zip)
    else if (e.dataTransfer.files.length) setError('Drop a .zip bundle, or use “Open your bundle”.')
  }

  const pickGene = (g: string) => { setGene(g); setTab('expression') }

  /* Every comparison this bundle can offer, and the one on screen.
   *
   * Both derived. `comparisons` is rebuilt when a DESeq2 run lands, so a pair
   * moves from "can be computed" to "computed here" without anything else being
   * told about it. */
  /* What can be said about the pair on screen — precomputed, computed here,
   * runnable, or not. One object, asked fresh whenever either side moves. */
  const state = useMemo(
    () => (bundle ? comparisonState(bundle, sel.control, sel.test, sel.excluded, computed) : null),
    [bundle, sel.control, sel.test, sel.excluded, computed])

  /* What the bundle got wrong, said once at the top rather than discovered as
   * an empty plot four tabs away. */
  const problems = useMemo(() => (bundle ? auditBundle(bundle) : []), [bundle])

  /* The contrast the tabs read, and the bundle they read it from.
   *
   * Either the pipeline's own table for this exact pair, or a DESeq2 run
   * performed here. A computed result is spliced into a derived bundle under a
   * synthetic id, so every tab keeps reading degByContrast[id] and needs no
   * knowledge of where the numbers came from. Both paths are DESeq2. */
  const active = useMemo(() => {
    if (!bundle || !state) return null
    const label = `${sideLabel(sel.test)} vs ${sideLabel(sel.control)}`

    if (state.source === 'bundle' && state.contrast) {
      return { bundle, contrast: state.contrast, pending: false }
    }
    // Both carry the exclusions, so a re-run with a different set of samples
    // is a different result rather than a cache hit on the previous one.
    const key = comparisonKey(bundle, sel.control, sel.test, sel.excluded)
    const id = `${computedContrastId(sel.test, sel.control)}${key.includes('|-') ? key.slice(key.indexOf('|-')) : ''}`
    const rows = computed[key]
    const contrast: Contrast = {
      id, numerator: sideLabel(sel.test), denominator: sideLabel(sel.control),
      label, deg_file: '',
      n_deg: rows ? countSignificant(rows) : undefined,
    }
    if (rows) {
      return {
        bundle: { ...bundle, degByContrast: { ...bundle.degByContrast, [id]: rows } },
        contrast, pending: false,
      }
    }
    // No statistics for this pair yet. Falling back to another contrast would
    // paint a different comparison's volcano and DEG table under this pair's
    // label — plausible numbers belonging to another question.
    return { bundle, contrast, pending: true }
  }, [bundle, state, sel.control, sel.test, computed])

  /* The gene-set library, owned here rather than by a tab.
   *
   * Enrichment used to own all of it — species, enabled collections, the
   * reader's own pasted sets — so Gene sets, the one tab whose whole subject is
   * gene sets, could not reach MSigDB at all. Held beside `geneText` above, for
   * the same reason: switching tabs must not discard what somebody chose. */
  const libGenes = useMemo(() => {
    const rows = active?.bundle.degByContrast[active.contrast.id]
    // Before a pair has statistics there is no tested-gene list, so the
    // measured genes stand in — enough for species detection, and the tabs that
    // need a real background are not shown until the statistics exist.
    if (rows?.length) return rows.map(r => r.gene_name || r.gene_id)
    const c = bundle?.counts
    return c ? c.geneIds.map((id, i) => c.geneNames[i] || id) : []
  }, [active, bundle])
  const embedded = useMemo(
    () => embeddedCollection(bundle?.genesets, bundle?.meta.project ?? ''),
    [bundle?.genesets, bundle?.meta.project])
  const library = useLibrary(libGenes, bundle?.meta.species, embedded)

  /** DESeq2 for the current pair, on explicit request — it is a real analysis. */
  const runPair = async () => {
    // Guarded on the state's own verdict rather than re-deriving one here — the
    // check that decides it lives in comparisonState, in one place.
    // Runnable when the pair has no table yet, AND when it has a precomputed
    // one that cannot honour the reader's exclusions — that second case was
    // unreachable, so the bar's own advice to "run DESeq2 here" had no button.
    const may = state?.source === 'computable'
      || (state?.source === 'bundle' && state.canRun && (state.staleExclusions?.length ?? 0) > 0)
    if (!bundle?.rawCounts || !may) return
    const pair = comparisonKey(bundle, sel.control, sel.test, sel.excluded)
    setRun({ pair, running: true, log: '' })
    const log = (m: string) => setRun(r => (r.pair === pair ? { ...r, log: m } : r))
    try {
      const rows = await runDESeq2(
        { raw: bundle.rawCounts, samples: bundle.samples,
          numerator: sel.test, denominator: sel.control, excluded: sel.excluded }, log)
      setComputed(c => ({ ...c, [pair]: rows }))
      setRun(r => (r.pair === pair ? { pair, running: false, log: '' } : r))
    } catch (e: any) {
      setRun(r => (r.pair === pair ? { pair, running: false, log: `Failed: ${e?.message || e}` } : r))
    }
  }

  const viewBundle = active?.bundle ?? bundle
  const contrast = active?.contrast
  // True when the selected pair has no DESeq2 result yet.
  const pending = !!active?.pending
  /** The run's own pair, so one pair's failure never renders under another. */
  const myRun = bundle && run.pair === comparisonKey(bundle, sel.control, sel.test, sel.excluded)
    ? run : { running: false, log: '' }

  return (
    <div className="relative mx-auto flex min-h-full max-w-6xl flex-col px-4"
      onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={onDrop}>
      {dragOver && (
        <div className="drop-overlay pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/80 text-lg font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
          Drop a .zip bundle to open it
        </div>
      )}
      <header className="flex flex-wrap items-center gap-3 py-4">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500 font-bold text-white">R</span>
          <div>
            <h1 className="text-lg font-semibold leading-none">RNA-seq Studio</h1>
            <p className="text-xs text-slate-400">Differential expression &amp; enrichment explorer</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* The contrast select that used to sit here is gone. It held its own
              state, the tabs derived theirs from elsewhere, and nothing kept
              the two in step — so the header could name one comparison over
              another one's numbers. There is one selector now, in the bar
              below, where the rest of the comparison's context is. */}
          {bundle && (
            <>
              <button className="btn btn-primary" onClick={() => zipRef.current?.click()}>⭱ Open bundle (.zip)</button>
              <button className="btn" onClick={() => fileRef.current?.click()} title="Open an unzipped bundle folder">folder…</button>
              <button className="btn" onClick={() => setShowStart(true)} title="Get a bundle from your counts or your raw FASTQ files">
                No results yet?
              </button>
            </>
          )}
          <button className="btn" onClick={() => setShowHelp(true)} title="What is a bundle & how to make one">?</button>
          <input ref={zipRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadZip(f); e.target.value = '' }} />
          <input ref={fileRef} type="file" className="hidden" multiple
            onChange={e => onUpload(e.target.files)}
            {...({ webkitdirectory: '', directory: '' } as any)} />
        </div>
      </header>

      {bundle?.meta.engine === 'sample-generator' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="pill bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100">DEMO</span>
          <span>
            <b>Simulated data — not your results.</b> Every number here is randomly generated.
          </span>
          <button className="btn ml-auto py-1" onClick={() => zipRef.current?.click()}>⭱ Open your bundle</button>
          <button className="btn py-1" onClick={() => { setBundle(null); setError(null) }}>Exit demo</button>
        </div>
      )}

      {/* Always shown, on every bundle.
          It used to be hidden unless there were more than two conditions, which
          meant the commonest bulk design of all — one treatment, one control —
          had no way to see which pair was being tested, and no way to reach the
          DESeq2 run button at all. Two conditions is exactly one comparison,
          and saying which one it is is not clutter. */}
      {bundle && state && (
        <ComparisonBar
          bundle={bundle} sel={sel} state={state}
          running={myRun.running} runLog={myRun.log}
          onSel={pickSel} onRun={runPair} />
      )}

      {/* What is wrong with the bundle, once, where it is read — not as an
          empty plot four tabs away. */}
      {bundle && problems.length > 0 && (
        <details className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-200">
            {problems.length} thing{problems.length === 1 ? '' : 's'} to know about this bundle
          </summary>
          <ul className="mt-2 space-y-1.5 text-amber-900/90 dark:text-amber-200/90">
            {problems.map((p, i) => <li key={i} className="text-xs leading-relaxed">{p.text}</li>)}
          </ul>
        </details>
      )}

      {bundle && (
        <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 dark:border-slate-700">
          {TABS.map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="flex-1 py-5">
        {loading && <Center>Loading dataset…</Center>}
        {!loading && error && (
          <Center>
            <p className="text-red-500">Could not load a result bundle.</p>
            <p className="mt-1 max-w-md text-xs text-slate-400">{error}</p>
            <button className="btn mt-4" onClick={() => setError(null)}>← Back</button>
          </Center>
        )}
        {!loading && !error && !bundle && (
          <Landing
            onOpenZip={() => zipRef.current?.click()}
            onOpenFolder={() => fileRef.current?.click()}
            onDemo={loadDemo}
            onFormat={() => setShowHelp(true)}
          />
        )}
        {!loading && bundle && contrast && (
          <ErrorBoundary key={tab}>
            {tab === 'overview' && <Overview bundle={viewBundle!} sel={sel} onSel={pickSel} />}
            {/* Expression needs no statistics, so it stays available while a pair
                is uncomputed; its DEG-derived panels hide themselves. */}
            {tab === 'expression' && (
              <GeneExpression
                bundle={viewBundle!} contrast={contrast} sel={sel} hasStats={!pending}
                text={geneText} onText={setGeneText}
                selectedGene={gene} onSelectGene={pickGene} />
            )}
            {/* Everything below is statistics. With none for this pair, showing
                anything at all would be showing another comparison's numbers. */}
            {tab !== 'overview' && tab !== 'expression' && pending && (
              <NeedsStats
                contrast={contrast} canCompute={!!bundle.rawCounts} running={myRun.running}
                runLog={myRun.log} onRun={runPair} />
            )}
            {!pending && (
              <>
                {tab === 'volcano' &&
                  <Volcano bundle={viewBundle!} contrast={contrast} onSelectGene={pickGene} />}
                {tab === 'degs' &&
                  <DEGTable bundle={viewBundle!} contrast={contrast} onSelectGene={pickGene} />}
                {tab === 'enrichment' &&
                  <Enrichment bundle={viewBundle!} contrast={contrast} library={library}
                    onSelectGene={pickGene} />}
                {tab === 'geneset' &&
                  <GeneSetExplorer bundle={viewBundle!} contrast={contrast} sel={sel}
                    library={library} onSelectGene={pickGene} />}
                {tab === 'methods' && <Methods bundle={viewBundle!} contrast={contrast} />}
              </>
            )}
          </ErrorBoundary>
        )}
      </main>

      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
        Runs locally in your browser · your data never leaves this device ·{' '}
        <button className="underline hover:text-indigo-600" onClick={() => setShowHelp(true)}>please cite</button>{' '}
        <a className="underline hover:text-indigo-600" href={DOI_URL} target="_blank" rel="noopener noreferrer">(DOI)</a>
      </footer>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showStart && (
        <GetStartedModal
          onClose={() => setShowStart(false)}
          onFormat={() => { setShowStart(false); setShowHelp(true) }}
        />
      )}
    </div>
  )
}

/**
 * Shown instead of a statistics tab when the selected pair has no DESeq2 result.
 * Deliberately blank of numbers: the alternative is displaying a different
 * comparison's volcano under this pair's name.
 */
function NeedsStats({ contrast, canCompute, running, runLog, onRun }: {
  contrast: Contrast; canCompute: boolean; running: boolean; runLog: string; onRun: () => void
}) {
  return (
    <div className="card mx-auto mt-6 max-w-xl p-8 text-center">
      <h3 className="text-base font-semibold">No DESeq2 result for this comparison yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        <b>{contrast.label}</b> was not exported by your pipeline
        {canCompute
          ? ', so nothing is shown here until it has been tested. Running it takes a few seconds after R loads.'
          : ', and this bundle has no raw counts to test it with.'}
      </p>
      {canCompute ? (
        <>
          <button className="btn btn-primary mt-4" disabled={running} onClick={onRun}>
            {running ? 'Running DESeq2…' : 'Run DESeq2 for this pair'}
          </button>
          {running && <p className="mt-2 text-xs text-slate-400">{runLog}</p>}
          {!running && runLog.startsWith('Failed') && (
            <p className="mt-2 text-xs text-red-500">{runLog}</p>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs text-slate-400">
          Re-export the bundle with <code className="font-mono">raw_counts.csv</code> — DESeq2 models
          raw counts, so a normalized matrix cannot stand in. Or pick a pair your pipeline exported.
        </p>
      )}
    </div>
  )
}

/**
 * First screen. Nothing is loaded until the visitor chooses — a dataset sitting
 * on screen at first paint reads as "your data", and every number on it belongs
 * to someone else. The demo is offered explicitly, and clearly labelled.
 */
function Landing({ onOpenZip, onOpenFolder, onDemo, onFormat }: {
  onOpenZip: () => void; onOpenFolder: () => void; onDemo: () => void; onFormat: () => void
}) {
  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Explore your RNA-seq results in the browser
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[13.5px] leading-relaxed text-slate-500">
          Gene search, volcano plots, tunable enrichment, your own gene sets and a drafted Methods
          paragraph — from a result bundle your pipeline already produced.
        </p>
      </div>

      {/* Primary action. The whole card is the drop target the page already listens on. */}
      <div className="card mt-8 border-dashed p-8 text-center">
        <p className="text-[15px] font-semibold">Open your result bundle</p>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Drop a <b>.zip</b> anywhere on this page, or pick one below.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={onOpenZip}>⭱ Open bundle (.zip)</button>
          <button className="btn" onClick={onOpenFolder}>Open a folder…</button>
        </div>
        <p className="mt-4 text-[11.5px] text-slate-400">
          Everything runs client-side — your data never leaves this device.
        </p>
      </div>

      <div className="mt-8">
        {/* Black and bold. This was the lightest grey on the page, which is the
            style for a caption above a title — as the only label for a section
            it read as a caption for nothing. The three "You have" eyebrows are
            folded in here rather than repeated on every card. */}
        <h3 className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-slate-900 dark:text-slate-100">
          Don&rsquo;t have a bundle yet? Start from what you have
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StartCard
            what="A count matrix"
            detail="Genes × samples, from featureCounts, STAR, Salmon, or your core facility."
            app="RNA-seq Lab"
            does="Runs DESeq2 or limma-voom in your browser and returns a bundle."
            cta="Open RNA-seq Lab ↗"
            href={LAB_URL}
          />
          <StartCard
            what="Only raw FASTQ"
            detail="The folder your sequencer or provider delivered."
            app="RNA-seq Service"
            does="Scans it, names your samples, and builds an analysis request."
            cta="Open RNA-seq Service ↗"
            href={SERVICE_URL}
          />
          <StartCard
            what="Your own pipeline"
            detail="nf-core, snakemake, or a script of your own."
            app="Bundle format"
            does="Five plain CSV files plus a small JSON manifest — emit those and it opens here."
            cta="See the format"
            onClick={onFormat}
          />
        </div>
      </div>

      <div className="mt-8 text-center">
        <button className="btn" onClick={onDemo}>Explore a demo dataset instead →</button>
        <p className="mt-2 text-[11.5px] text-slate-400">
          Simulated data, for trying the interface. It is labelled throughout so it is never
          mistaken for your own.
        </p>
      </div>
    </div>
  )
}

/**
 * Studio only reads bundles, so a visitor with nothing to open is at a dead end.
 * Route them by what they already have: counts → Lab, raw FASTQ → Service.
 */
function GetStartedModal({ onClose, onFormat }: { onClose: () => void; onFormat: () => void }) {
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <div className="modal-panel card my-8 w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold">Don’t have a result bundle yet?</h2>
          <button className="btn py-1" onClick={onClose}>✕</button>
        </div>
        <p className="text-sm text-slate-500">
          RNA-seq Studio is the <b>explorer</b> — it opens results that already exist. Pick whichever
          describes what you have right now and we’ll get you a bundle to bring back here.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <StartCard
            what="A gene count matrix"
            detail="A CSV/TSV of genes × samples — e.g. from featureCounts, STAR, Salmon, or your core facility."
            app="RNA-seq Lab"
            does="Runs DESeq2 or limma-voom in your browser and hands you a bundle. Free, nothing uploaded."
            cta="Open RNA-seq Lab ↗"
            href={LAB_URL}
          />
          <StartCard
            what="Only raw FASTQ files"
            detail="The folder your sequencer or provider delivered, full of .fastq.gz files."
            app="RNA-seq Service"
            does="Scans the folder, names your samples, and builds an analysis request to send us."
            cta="Open RNA-seq Service ↗"
            href={SERVICE_URL}
          />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <b>Already ran your own pipeline?</b> Any tool can produce a bundle — it’s five plain CSV
          files.{' '}
          <button className="underline hover:text-indigo-600" onClick={onFormat}>See the format</button>.
        </div>

        <p className="mt-3 text-xs text-slate-400">
          All three tools run entirely in your browser. Your data never leaves your device.
        </p>
      </div>
    </div>
  )
}

/**
 * One route out of the dead end, keyed by what the visitor already has.
 *
 * These are alternatives, not a ranking, so they are styled identically. They
 * used to carry a colour each — indigo border and filled button, emerald border
 * and filled button, grey border and outline button — which read as three
 * different kinds of thing and implied the grey one was the lesser option. The
 * only thing that should differ between them is the words.
 */
function StartCard({ what, detail, app, does, cta, href, onClick }: {
  what: string; detail: string; app: string; does: string; cta: string
  href?: string; onClick?: () => void
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600">
      <div className="text-[14px] font-semibold">{what}</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{detail}</p>
      <div className="mt-3 inline-flex w-fit rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
        {app}
      </div>
      <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-slate-500">{does}</p>
      {href
        ? (
          <a className="btn btn-primary mt-3 justify-center" href={href}
            target="_blank" rel="noopener noreferrer">{cta}</a>
        )
        : <button className="btn btn-primary mt-3 justify-center" onClick={onClick}>{cta}</button>}
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <div className="modal-panel card my-8 w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold">Open your own result bundle</h2>
          <button className="btn py-1" onClick={onClose}>✕</button>
        </div>
        <p className="text-sm text-slate-500">
          RNA-seq Studio is a viewer: it reads a <b>result bundle</b> produced by your analysis pipeline and renders it
          entirely in your browser — <b>nothing is uploaded</b>. Any tool that emits the format below will work.
          <b> Drop a .zip</b> anywhere on the page (or use <b>Open bundle</b>); an unzipped folder works too.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Bundle = these files (zipped, or a folder)</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
          <table className="w-full text-sm">
            <tbody className="[&_td]:px-3 [&_td]:py-1.5 [&_tr]:border-t [&_tr]:border-slate-100 dark:[&_tr]:border-slate-800">
              <tr><td className="font-mono">meta.json</td><td>project, species, control, and the list of contrasts</td></tr>
              <tr><td className="font-mono">samples.csv</td><td><span className="font-mono text-xs">sample, condition, [covariates…]</span></td></tr>
              <tr><td className="font-mono">normalized_counts.csv</td><td><span className="font-mono text-xs">gene_id, [gene_name,] &lt;sample1&gt;, &lt;sample2&gt;, …</span></td></tr>
              <tr><td className="font-mono">raw_counts.csv <span className="text-slate-400">(optional)</span></td><td>same shape, un-normalized — lets Studio run DESeq2 on pairs you did not export</td></tr>
              <tr><td className="font-mono">deg_&lt;contrast&gt;.csv</td><td><span className="font-mono text-xs">gene_id, gene_name, baseMean, log2FoldChange, lfcSE, pvalue, padj</span></td></tr>
              <tr><td className="font-mono">genesets.csv <span className="text-slate-400">(optional)</span></td><td><span className="font-mono text-xs">source, set_id, set_name, genes</span> — enables live ORA</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          One <code>deg_&lt;contrast&gt;.csv</code> per contrast (named in <code>meta.json</code>). Missing values may be <code>NA</code>.
          Counts should be normalized (e.g. DESeq2 median-of-ratios). The full typed spec lives in the project's <code>src/types.ts</code> / README.
        </p>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">How to cite</h3>
        <p className="mt-1 text-sm text-slate-500">If RNA-seq Studio helped your work, please cite it:</p>
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {CITATION}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn py-1" onClick={() => { navigator.clipboard?.writeText(CITATION); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            {copied ? 'Copied ✓' : 'Copy citation'}
          </button>
          <a className="btn py-1" href={DOI_URL} target="_blank" rel="noopener noreferrer">Open DOI ↗</a>
        </div>
      </div>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center py-24 text-center text-sm text-slate-500">{children}</div>
}
