import { useEffect, useMemo, useState } from 'react'
import type { Bundle } from '../types'
import type { Catalogue, CatalogueEntry } from '../lib/catalogue'
import { formatBytes, loadCatalogue, openDataset, searchDatasets, speciesIn } from '../lib/catalogue'

/**
 * The data space: datasets published on this deployment, ready to open.
 *
 * A CHOOSING surface, not a file list. Somebody picking a dataset is asking a
 * biological question — which cohort, which species, how many arms, what was
 * compared — so every row answers those before it is clicked. A list of
 * filenames and sizes would make them open three to find one.
 *
 * It renders nothing at all when there is no catalogue, which is what keeps one
 * build serving both the public studio and a lab deployment. See lib/catalogue.
 */
export default function DataSpace({ onOpen, onError, compact }: {
  onOpen: (bundle: Bundle, entry: CatalogueEntry) => void
  onError: (message: string) => void
  /** Inside the modal, where the header has already said what this is. */
  compact?: boolean
}) {
  const [state, setState] = useState<{ catalogue: Catalogue; dropped: number } | null | 'loading'>('loading')
  const [query, setQuery] = useState('')
  const [species, setSpecies] = useState('all')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadCatalogue().then(r => { if (live) setState(r) }, () => { if (live) setState(null) })
    return () => { live = false }
  }, [])

  const all = state && state !== 'loading' ? state.catalogue.datasets : []
  const kinds = useMemo(() => speciesIn(all), [all])
  const shown = useMemo(() => searchDatasets(all, query, species), [all, query, species])

  const open = async (entry: CatalogueEntry) => {
    setBusy(entry.slug)
    try { onOpen(await openDataset(entry), entry) }
    catch (e: any) { onError(`Could not open ${entry.title} — ${e?.message || e}`) }
    finally { setBusy(null) }
  }

  // Loading and absent are the same to a reader: nothing to show. The panel
  // must not flash a heading and then vanish on a deployment that has no
  // catalogue, so it stays silent until it knows.
  if (state === 'loading' || state === null) return null

  return (
    <section className={compact ? '' : 'card p-5'}>
      {!compact && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold">
            {state.catalogue.name || 'Published datasets'}
          </h2>
          <p className="text-[12.5px] text-slate-500">
            Open one and every tab works on it — the same analysis as a bundle of your own.
          </p>
          {state.catalogue.updated && (
            <span className="ml-auto font-mono text-[11px] text-slate-400">
              updated {state.catalogue.updated}
            </span>
          )}
        </div>
      )}

      {/* Controls appear only when there is enough to sift. Three datasets do
          not need a search box, and an empty filter row reads as a broken one. */}
      {all.length > 4 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className="input w-56 py-1 text-sm" placeholder="Search datasets…"
            aria-label="Search datasets" value={query} onChange={e => setQuery(e.target.value)} />
          {kinds.length > 1 && (
            <div className="flex gap-1">
              {['all', ...kinds].map(k => (
                <button key={k} aria-pressed={species === k}
                  onClick={() => setSpecies(k)}
                  className={`pressable rounded-md border px-2 py-0.5 text-xs capitalize transition ${species === k
                    ? 'border-indigo-400 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700'}`}>
                  {k}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {shown.length === all.length
              ? `${all.length} dataset${all.length === 1 ? '' : 's'}`
              : `${shown.length} of ${all.length}`}
          </span>
        </div>
      )}

      {!all.length ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
          No datasets published yet.
        </p>
      ) : !shown.length ? (
        <p className="px-1 py-6 text-center text-sm text-slate-400">
          Nothing matches “{query}”.
        </p>
      ) : (
        <ul className="grid gap-2">
          {shown.map(d => (
            <li key={d.slug}>
              <DatasetRow entry={d} busy={busy === d.slug} disabled={!!busy && busy !== d.slug}
                onOpen={() => open(d)} />
            </li>
          ))}
        </ul>
      )}

      {state.dropped > 0 && (
        <p className="mt-2 text-[11.5px] text-amber-600 dark:text-amber-400">
          {state.dropped} entr{state.dropped === 1 ? 'y' : 'ies'} in the catalogue could not be read
          — each needs a slug, a title and a url — and {state.dropped === 1 ? 'is' : 'are'} not listed.
        </p>
      )}
    </section>
  )
}

/**
 * One dataset, as a row you can decide from.
 *
 * A button rather than a card with a button in it: the whole row is the target,
 * which is what everyone tries first, and it keeps one focus stop per dataset
 * instead of one per card plus one per link.
 */
function DatasetRow({ entry, busy, disabled, onOpen }: {
  entry: CatalogueEntry; busy: boolean; disabled: boolean; onOpen: () => void
}) {
  const d = entry
  return (
    <button
      onClick={onOpen} disabled={busy || disabled}
      className="pressable group flex w-full items-start gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-indigo-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{d.title}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {d.species}
          </span>
          {d.source && <span className="text-[11.5px] text-slate-400">{d.source}</span>}
        </div>

        {d.description && (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">
            {d.description}
          </p>
        )}

        {/* The design, not the file. This is the row somebody actually reads:
            how many arms, which ones, and what was compared. */}
        {!!d.conditions?.length && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {d.conditions.slice(0, 6).map(c => (
              <span key={c} className="rounded border border-slate-200 px-1.5 py-px font-mono text-[10.5px] text-slate-500 dark:border-slate-700">
                {c}
              </span>
            ))}
            {d.conditions.length > 6 && (
              <span className="text-[10.5px] text-slate-400">+{d.conditions.length - 6}</span>
            )}
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-400">
          {d.samples != null && <span>{d.samples} samples</span>}
          {d.genes != null && <span>{d.genes.toLocaleString()} genes</span>}
          {!!d.contrasts?.length && (
            <span title={d.contrasts.join(' · ')}>
              {d.contrasts.length} comparison{d.contrasts.length === 1 ? '' : 's'}
            </span>
          )}
          {d.bytes != null && <span>{formatBytes(d.bytes)}</span>}
          {d.published && <span>{d.published}</span>}
        </div>
      </div>

      <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${busy
        ? 'bg-slate-100 text-slate-500 dark:bg-slate-800'
        : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-500 group-hover:text-white dark:bg-indigo-500/15 dark:text-indigo-300'}`}>
        {busy ? 'Opening…' : 'Open'}
      </span>
    </button>
  )
}
