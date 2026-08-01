import { useCallback, useMemo, useRef, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from './types'
import type { GroupSel } from './lib/design'
import { defaultSelection } from './lib/design'
import { computedContrastId, countSignificant, runDESeq2 } from './lib/deseq'
import { loadBundleFromUrl, loadBundleFromFiles, loadBundleFromZip } from './lib/bundle'
import { ErrorBoundary } from './lib/ErrorBoundary'
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
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'expression', label: 'Gene expression' },
  { id: 'volcano', label: 'Volcano' },
  { id: 'degs', label: 'DEG table' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'geneset', label: 'Gene sets' },
  { id: 'methods', label: 'Methods' },
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [contrastId, setContrastId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('overview')
  const [gene, setGene] = useState<string | null>(null)
  const [sel, setSel] = useState<GroupSel>({ control: '', groups: [] })
  // Which selected arm the DEG statistics describe (control is the reference).
  const [focus, setFocus] = useState<string>('')
  // DESeq2 results computed this session, keyed by "<numerator>|<denominator>".
  const [computed, setComputed] = useState<Record<string, DEGRow[]>>({})
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState<string>('')
  const [showHelp, setShowHelp] = useState(false)
  const [showStart, setShowStart] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const adopt = useCallback((b: Bundle) => {
    setBundle(b)
    const first = b.meta.contrasts[0]
    setContrastId(first?.id ?? '')
    const s = defaultSelection(b.meta, first)
    setSel(s)
    setFocus(first?.numerator ?? s.groups[0] ?? '')
    setGene(null)
    setTab('overview')
    setError(null)
  }, [])

  // Switching contrast moves the reference and the focus arm with it.
  const pickContrast = (id: string) => {
    setContrastId(id)
    const c = bundle?.meta.contrasts.find(x => x.id === id)
    if (!c) return
    setSel(s => ({
      control: c.denominator,
      groups: s.groups.includes(c.numerator)
        ? s.groups.filter(g => g !== c.denominator)
        : [...s.groups.filter(g => g !== c.denominator), c.numerator],
    }))
    setFocus(c.numerator)
  }

  const pickSel = (next: GroupSel) => {
    setSel(next)
    if (!next.groups.includes(focus)) setFocus(next.groups[0] ?? '')
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

  /* The comparison every tab reports on.
   *
   * Either the pipeline's own contrast, or a DESeq2 run performed here for a
   * pair it never exported. Computed results are spliced into a derived bundle
   * under a synthetic id, so every tab keeps reading degByContrast[id] and needs
   * no knowledge of where the numbers came from. Both paths are DESeq2. */
  const active = useMemo(() => {
    if (!bundle) return null
    const pre = bundle.meta.contrasts.find(c => c.denominator === sel.control && c.numerator === focus)
    if (pre) return { bundle, contrast: pre, computed: false }

    const rows = focus && sel.control ? computed[`${focus}|${sel.control}`] : undefined
    if (rows) {
      const id = computedContrastId(focus, sel.control)
      return {
        bundle: { ...bundle, degByContrast: { ...bundle.degByContrast, [id]: rows } },
        contrast: {
          id, numerator: focus, denominator: sel.control,
          label: `${focus} vs ${sel.control}`, deg_file: '', n_deg: countSignificant(rows),
        } as Contrast,
        computed: true,
      }
    }
    // No statistics for this pair yet. Falling back to another contrast here
    // would paint a different comparison's volcano and DEG table under this
    // pair's label — plausible numbers belonging to another question. Return a
    // contrast with no rows instead, and let the tabs say so.
    return {
      bundle,
      contrast: {
        id: `~pending:${focus}_vs_${sel.control}`,
        numerator: focus, denominator: sel.control,
        label: focus && sel.control ? `${focus} vs ${sel.control}` : 'no comparison selected',
        deg_file: '',
      } as Contrast,
      computed: false,
      pending: true,
    }
  }, [bundle, sel.control, focus, computed])

  /** DESeq2 for the current pair, on explicit request — it is a real analysis. */
  const runPair = async () => {
    if (!bundle?.rawCounts || !focus || !sel.control) return
    setRunning(true); setRunLog('')
    const log = (m: string) => setRunLog(m)
    try {
      const rows = await runDESeq2(
        { raw: bundle.rawCounts, samples: bundle.samples, numerator: focus, denominator: sel.control }, log)
      setComputed(c => ({ ...c, [`${focus}|${sel.control}`]: rows }))
    } catch (e: any) {
      setRunLog(`Failed: ${e?.message || e}`)
    } finally {
      setRunning(false)
    }
  }

  const viewBundle = active?.bundle ?? bundle
  const contrast = active?.contrast
  // True when the selected pair has no DESeq2 result yet.
  const pending = !!active?.pending

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
          {/* On the landing screen the actions live in the hero, not up here. */}
          {bundle && bundle.meta.contrasts.length > 1 && (
            <select className="input" value={contrastId} onChange={e => pickContrast(e.target.value)}>
              {bundle.meta.contrasts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
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

      {/* Only worth showing when there is something to choose between. */}
      {bundle && contrast && bundle.meta.conditions.length > 2 && (
        <GroupBar
          bundle={bundle} contrast={contrast} sel={sel} focus={focus}
          computed={!!active?.computed} running={running} runLog={runLog}
          hasPair={!!(focus && bundle.meta.contrasts.some(c => c.denominator === sel.control && c.numerator === focus))
            || !!computed[`${focus}|${sel.control}`]}
          onChange={pickSel} onFocus={setFocus} onRun={runPair} />
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
          <ErrorBoundary key={`${tab}:${contrast.id}`}>
            {tab === 'overview' && <Overview bundle={viewBundle!} />}
            {/* Expression needs no statistics, so it stays available while a pair
                is uncomputed; its DEG-derived panels hide themselves. */}
            {tab === 'expression' && (
              <GeneExpression
                bundle={viewBundle!} contrast={contrast} sel={sel} hasStats={!pending}
                selectedGene={gene} onSelectGene={pickGene} />
            )}
            {/* Everything below is statistics. With none for this pair, showing
                anything at all would be showing another comparison's numbers. */}
            {tab !== 'overview' && tab !== 'expression' && pending && (
              <NeedsStats
                contrast={contrast} canCompute={!!bundle.rawCounts} running={running}
                runLog={runLog} onRun={runPair} />
            )}
            {!pending && (
              <>
                {tab === 'volcano' &&
                  <Volcano bundle={viewBundle!} contrast={contrast} onSelectGene={pickGene} />}
                {tab === 'degs' &&
                  <DEGTable bundle={viewBundle!} contrast={contrast} onSelectGene={pickGene} />}
                {tab === 'enrichment' &&
                  <Enrichment bundle={viewBundle!} contrast={contrast} onSelectGene={pickGene} />}
                {tab === 'geneset' &&
                  <GeneSetExplorer bundle={viewBundle!} contrast={contrast} sel={sel} onSelectGene={pickGene} />}
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
 * Choose the reference group and which arms to look at. One selection, read by
 * every expression view, so a 23-arm design can be narrowed to the three arms a
 * given question is about.
 */
function GroupBar({
  bundle, contrast, sel, focus, computed, running, runLog, hasPair, onChange, onFocus, onRun,
}: {
  bundle: Bundle; contrast: Contrast; sel: GroupSel; focus: string
  computed: boolean; running: boolean; runLog: string; hasPair: boolean
  onChange: (s: GroupSel) => void; onFocus: (g: string) => void; onRun: () => void
}) {
  const canCompute = !!bundle.rawCounts
  const all = bundle.meta.conditions
  const nSamples = (c: string) => bundle.samples.filter(s => s.condition === c).length

  const toggle = (c: string) => onChange({
    ...sel,
    groups: sel.groups.includes(c) ? sel.groups.filter(g => g !== c) : [...sel.groups, c],
  })

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Control</span>
          <select
            className="input py-1" value={sel.control}
            onChange={e => onChange({
              control: e.target.value,
              groups: sel.groups.filter(g => g !== e.target.value),
            })}
          >
            {all.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn py-1 text-xs"
            onClick={() => onChange({ control: sel.control, groups: all.filter(c => c !== sel.control) })}>
            Select all
          </button>
          <button className="btn py-1 text-xs"
            onClick={() => onChange({ control: sel.control, groups: [] })}>
            Remove all
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Compare</span>
        {all.filter(c => c !== sel.control).map(c => {
          const on = sel.groups.includes(c)
          const testable = bundle.meta.contrasts.some(x => x.denominator === sel.control && x.numerator === c)
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              title={`${nSamples(c)} samples · ${testable ? 'has a contrast against ' + sel.control : 'no contrast against ' + sel.control}`}
              className={`pressable rounded-md border px-2 py-0.5 text-xs transition ${
                on
                  ? 'border-indigo-400 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700'}`}
            >{c}{testable && <span className="ml-1 opacity-60" aria-hidden="true">•</span>}</button>
          )
        })}
      </div>

      {/* Which pair the DEG statistics describe. Precomputed when the pipeline
          exported it, otherwise DESeq2 is run here on the raw counts. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Statistics for
        </span>
        {sel.groups.length === 0 ? (
          <span className="text-xs text-slate-400">select an arm to compare against {sel.control}</span>
        ) : (
          <>
            <select className="input py-1 text-sm" value={focus} onChange={e => onFocus(e.target.value)}>
              {sel.groups.map(g => <option key={g} value={g}>{g} vs {sel.control}</option>)}
            </select>

            {hasPair ? (
              <>
                <span className={`pill ${computed
                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'}`}>
                  DESeq2 · {computed ? 'run here' : 'from your pipeline'}
                </span>
                {typeof contrast.n_deg === 'number' && (
                  <span className="text-xs text-slate-500">
                    {contrast.n_deg.toLocaleString()} DEGs · padj &lt; 0.05, |log2FC| ≥ 1
                  </span>
                )}
              </>
            ) : canCompute ? (
              <>
                <button className="btn btn-primary py-1 text-xs" disabled={running} onClick={onRun}>
                  {running ? 'Running DESeq2…' : 'Run DESeq2 for this pair'}
                </button>
                <span className="text-xs text-slate-400">
                  {running ? runLog : 'not exported by your pipeline — runs in your browser (R + DESeq2)'}
                </span>
              </>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                not exported by your pipeline, and this bundle has no <code>raw_counts.csv</code> —
                DESeq2 needs raw counts, so this pair cannot be tested here.
              </span>
            )}
            {!running && runLog.startsWith('Failed') && (
              <span className="text-xs text-red-500">{runLog}</span>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        <b>{sel.groups.length + 1}</b> of {all.length} groups shown, against <b>{sel.control}</b> —
        applies to gene expression, gene sets and the heatmap.
        {computed && ' This pair was not in the bundle, so DESeq2 was run here on the raw counts — the same method, so the numbers are comparable with the exported contrasts.'}
      </p>
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
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-slate-500">
          Search any gene, scan volcano plots, run tunable enrichment, score your own gene sets,
          and draft your Methods paragraph — from a result bundle your pipeline already produced.
        </p>
      </div>

      {/* Primary action. The whole card is the drop target the page already listens on. */}
      <div className="card mt-8 border-dashed p-8 text-center">
        <p className="text-base font-medium">Open your result bundle</p>
        <p className="mt-1 text-sm text-slate-500">
          Drop a <b>.zip</b> anywhere on this page, or pick one below.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={onOpenZip}>⭱ Open bundle (.zip)</button>
          <button className="btn" onClick={onOpenFolder}>Open a folder…</button>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Everything runs client-side — your data never leaves this device.
        </p>
      </div>

      <div className="mt-8">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          Don't have a bundle yet?
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StartCard
            step="You have"
            what="A count matrix"
            detail="Genes × samples, from featureCounts, STAR, Salmon, or your core facility."
            app="RNA-seq Lab"
            does="Runs DESeq2 or limma-voom in your browser and returns a bundle."
            href={LAB_URL}
            accent="indigo"
          />
          <StartCard
            step="You have"
            what="Only raw FASTQ"
            detail="The folder your sequencer or provider delivered."
            app="RNA-seq Service"
            does="Scans it, names your samples, and builds an analysis request."
            href={SERVICE_URL}
            accent="emerald"
          />
          <div className="flex flex-col rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">You have</div>
            <div className="mt-1 text-sm font-semibold">Your own pipeline</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              nf-core, snakemake, or a script of your own.
            </p>
            <div className="mt-3 inline-flex w-fit rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
              Bundle format
            </div>
            <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-500">
              Five plain CSV files plus a small JSON manifest — emit those and it opens here.
            </p>
            <button className="btn mt-3 justify-center" onClick={onFormat}>See the format</button>
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <button className="btn" onClick={onDemo}>Explore a demo dataset instead →</button>
        <p className="mt-2 text-xs text-slate-400">
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
            step="Start here if you have"
            what="A gene count matrix"
            detail="A CSV/TSV of genes × samples — e.g. from featureCounts, STAR, Salmon, or your core facility."
            app="RNA-seq Lab"
            does="Runs DESeq2 or limma-voom in your browser and hands you a bundle. Free, nothing uploaded."
            href={LAB_URL}
            accent="indigo"
          />
          <StartCard
            step="Start here if you have"
            what="Only raw FASTQ files"
            detail="The folder your sequencer or provider delivered, full of .fastq.gz files."
            app="RNA-seq Service"
            does="Scans the folder, names your samples, and builds an analysis request to send us."
            href={SERVICE_URL}
            accent="emerald"
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

function StartCard({ step, what, detail, app, does, href, accent }: {
  step: string; what: string; detail: string; app: string; does: string; href: string
  accent: 'indigo' | 'emerald'
}) {
  const ring = accent === 'indigo'
    ? 'border-indigo-200 hover:border-indigo-400 dark:border-indigo-500/30'
    : 'border-emerald-200 hover:border-emerald-400 dark:border-emerald-500/30'
  const chip = accent === 'indigo'
    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  return (
    <div className={`flex flex-col rounded-xl border p-4 transition ${ring}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{step}</div>
      <div className="mt-1 text-sm font-semibold">{what}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
      <div className={`mt-3 inline-flex w-fit rounded-md px-2 py-0.5 text-xs font-semibold ${chip}`}>{app}</div>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-500">{does}</p>
      <a className="btn btn-primary mt-3 justify-center" href={href} target="_blank" rel="noopener noreferrer">
        Open {app} ↗
      </a>
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
