import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bundle } from './types'
import { loadBundleFromUrl, loadBundleFromFiles } from './lib/bundle'
import Overview from './components/Overview'
import GeneExpression from './components/GeneExpression'
import GeneSetExplorer from './components/GeneSetExplorer'
import Volcano from './components/Volcano'
import DEGTable from './components/DEGTable'
import Enrichment from './components/Enrichment'

type Tab = 'overview' | 'expression' | 'geneset' | 'volcano' | 'degs' | 'enrichment'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'expression', label: 'Gene expression' },
  { id: 'geneset', label: 'Gene sets' },
  { id: 'volcano', label: 'Volcano' },
  { id: 'degs', label: 'DEG table' },
  { id: 'enrichment', label: 'Enrichment' },
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [contrastId, setContrastId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('overview')
  const [gene, setGene] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  const pickGene = (g: string) => { setGene(g); setTab('expression') }

  const contrast = bundle?.meta.contrasts.find(c => c.id === contrastId) ?? bundle?.meta.contrasts[0]

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4">
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
          <button className="btn" onClick={() => fileRef.current?.click()}>⭱ Open analysis folder</button>
          <input ref={fileRef} type="file" className="hidden" multiple
            onChange={e => onUpload(e.target.files)}
            {...({ webkitdirectory: '', directory: '' } as any)} />
        </div>
      </header>

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
          <>
            {tab === 'overview' &&
              <Overview bundle={bundle} onOpenContrast={id => { setContrastId(id); setTab('volcano') }} />}
            {tab === 'expression' &&
              <GeneExpression bundle={bundle} contrast={contrast} selectedGene={gene} onSelectGene={pickGene} />}
            {tab === 'geneset' &&
              <GeneSetExplorer bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'volcano' &&
              <Volcano bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'degs' &&
              <DEGTable bundle={bundle} contrast={contrast} onSelectGene={pickGene} />}
            {tab === 'enrichment' &&
              <Enrichment bundle={bundle} contrast={contrast} />}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
        Runs locally in your browser · your data never leaves this device
      </footer>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center py-24 text-center text-sm text-slate-500">{children}</div>
}
