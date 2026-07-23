import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bundle } from './types'
import { loadBundleFromUrl, loadBundleFromFiles, loadBundleFromZip } from './lib/bundle'
import { ErrorBoundary } from './lib/ErrorBoundary'
import Overview from './components/Overview'
import GeneExpression from './components/GeneExpression'
import GeneSetExplorer from './components/GeneSetExplorer'
import Volcano from './components/Volcano'
import DEGTable from './components/DEGTable'
import Enrichment from './components/Enrichment'

const DOI_URL = 'https://doi.org/10.5281/zenodo.21514152'
const CITATION = 'Lin, J. (2026). RNA-seq Studio: a privacy-preserving, client-side interactive explorer for bulk RNA-seq results (v1.0.0). Zenodo. https://doi.org/10.5281/zenodo.21514152'

type Tab = 'overview' | 'expression' | 'volcano' | 'degs' | 'enrichment' | 'geneset'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'expression', label: 'Gene expression' },
  { id: 'volcano', label: 'Volcano' },
  { id: 'degs', label: 'DEG table' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'geneset', label: 'Gene sets' },
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [contrastId, setContrastId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('overview')
  const [gene, setGene] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const adopt = useCallback((b: Bundle) => {
    setBundle(b)
    setContrastId(b.meta.contrasts[0]?.id ?? '')
    setGene(null)
    setTab('overview')
    setError(null)
  }, [])

  // Auto-load the bundled sample dataset on first paint.
  useEffect(() => {
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

  const contrast = bundle?.meta.contrasts.find(c => c.id === contrastId) ?? bundle?.meta.contrasts[0]

  return (
    <div className="relative mx-auto flex min-h-full max-w-6xl flex-col px-4"
      onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={onDrop}>
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/80 text-lg font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
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
          {bundle && bundle.meta.contrasts.length > 1 && (
            <select className="input" value={contrastId} onChange={e => setContrastId(e.target.value)}>
              {bundle.meta.contrasts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <button className="btn btn-primary" onClick={() => zipRef.current?.click()}>⭱ Open bundle (.zip)</button>
          <button className="btn" onClick={() => fileRef.current?.click()} title="Open an unzipped bundle folder">folder…</button>
          <button className="btn" onClick={() => setShowHelp(true)} title="What is a bundle & how to make one">?</button>
          <input ref={zipRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadZip(f); e.target.value = '' }} />
          <input ref={fileRef} type="file" className="hidden" multiple
            onChange={e => onUpload(e.target.files)}
            {...({ webkitdirectory: '', directory: '' } as any)} />
        </div>
      </header>

      {bundle?.meta.engine === 'sample-generator' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
          <span>👋 This is a <b>demo dataset</b>. Drop a <b>.zip</b> bundle anywhere (or use the button) to explore your data — it never leaves your browser.</span>
          <button className="btn ml-auto py-1" onClick={() => zipRef.current?.click()}>⭱ Open bundle (.zip)</button>
          <button className="btn py-1" onClick={() => setShowHelp(true)}>Format</button>
        </div>
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
            <button className="btn mt-4" onClick={() => fileRef.current?.click()}>Open an analysis folder</button>
          </Center>
        )}
        {!loading && bundle && contrast && (
          <ErrorBoundary key={`${tab}:${contrastId}`}>
            {tab === 'overview' &&
              <Overview bundle={bundle} onOpenContrast={id => { setContrastId(id); setTab('volcano') }} />}
            {tab === 'expression' &&
              <GeneExpression bundle={bundle} contrast={contrast} selectedGene={gene} onSelectGene={pickGene} />}
            {tab === 'volcano' &&
              <Volcano bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'degs' &&
              <DEGTable bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'enrichment' &&
              <Enrichment bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'geneset' &&
              <GeneSetExplorer bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
          </ErrorBoundary>
        )}
      </main>

      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
        Runs locally in your browser · your data never leaves this device ·{' '}
        <button className="underline hover:text-indigo-600" onClick={() => setShowHelp(true)}>please cite</button>{' '}
        <a className="underline hover:text-indigo-600" href={DOI_URL} target="_blank" rel="noopener noreferrer">(DOI)</a>
      </footer>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
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
