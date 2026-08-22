import type { Bundle } from '../types'
import type { Comparison } from '../lib/contrast'
import { MIN_REPLICATES } from '../lib/contrast'

/**
 * The one control that says what is being compared.
 *
 * It replaced four, which between them held three pieces of state and could
 * disagree with each other and with the tabs below. There was a contrast select
 * in the header, a Control select, a row of Compare chips, and a second
 * "Statistics for" select; the analysis was derived from the last two and the
 * header from the first, so changing the control moved every number on the page
 * while the header went on naming the comparison it had been set to. The
 * screenshot that prompted this had the header saying "KO vs Ctrl (at Cold)"
 * over statistics for KO_Thermo vs KO_Cold, with a green "1 DEGs" badge beside a
 * red failure from a different pair entirely.
 *
 * So there is one list of the comparisons that exist and one selected id. The
 * arms drawn in the per-sample plots are still a choice — a 20-arm design is
 * unreadable with every arm on — but it is now visibly a DISPLAY choice, under
 * its own heading, and it cannot change what is tested.
 */
export default function ComparisonBar({
  bundle, comparisons, current, extras, running, runLog,
  onPick, onExtras, onRun,
}: {
  bundle: Bundle
  comparisons: Comparison[]
  current: Comparison
  /** Arms shown in the per-sample plots on top of the compared pair. */
  extras: string[]
  running: boolean
  /** Progress or failure for THIS comparison only — see App's runState. */
  runLog: string
  onPick: (id: string) => void
  onExtras: (next: string[]) => void
  onRun: () => void
}) {
  const groups = [
    ['From your pipeline', comparisons.filter(c => c.source === 'bundle')],
    ['Computed here, this session', comparisons.filter(c => c.source === 'computed')],
    ['Can be computed here', comparisons.filter(c => c.source === 'computable')],
    ['Not available', comparisons.filter(c => c.source === 'unavailable')],
  ] as const

  // The pair's own two groups are always drawn and are not removable: taking
  // the reference out of the plots while it is the reference of the test is
  // exactly the inconsistency this bar exists to remove.
  const pinned = current.groupsAreConditions
    ? [current.denominator, current.numerator]
    : []
  const others = bundle.meta.conditions.filter(c => !pinned.includes(c))

  const failed = runLog.startsWith('Failed')

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Comparison
        </span>
        <select
          className="input min-w-[18rem] py-1 text-sm" value={current.id}
          aria-label="Which comparison the statistics describe"
          onChange={e => onPick(e.target.value)}
        >
          {groups.map(([label, list]) => list.length === 0 ? null : (
            <optgroup key={label} label={label}>
              {list.map(c => (
                <option key={c.id} value={c.id} title={c.blocked}>
                  {c.label}
                  {c.groupsAreConditions ? ` · ${c.nNumerator} vs ${c.nDenominator}` : ' · not tied to samples'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <Provenance c={current} bundle={bundle} />

        {current.source === 'computable' && (
          <button className="btn btn-primary py-1 text-xs" disabled={running} onClick={onRun}>
            {running ? 'Running DESeq2…' : 'Run DESeq2 for this pair'}
          </button>
        )}
        {running && <span className="text-xs text-slate-400">{runLog}</span>}
      </div>

      {/* Why a comparison cannot be run, stated where it is chosen rather than
          after a click that was never going to work. */}
      {current.source === 'unavailable' && current.blocked && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">{current.blocked}</p>
      )}

      {/* A contrast the pipeline exported whose groups are not sample
          conditions. The results are real; what cannot be done is tie them to
          samples, and saying so here is the difference between an explained
          limitation and an empty plot. */}
      {!current.groupsAreConditions && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          This contrast compares <b>{current.numerator}</b> and <b>{current.denominator}</b>, which are
          not conditions any sample has — so its differential expression, volcano and enrichment are
          shown as exported, but per-sample expression and the heatmap cannot be tied to it. Pick a
          comparison between two of this bundle&rsquo;s own conditions for those.
        </p>
      )}

      {/* A failure belongs to the pair it happened on, and is cleared when the
          comparison changes. It used to be one variable for the whole app, so a
          failure on one pair sat under a successful result for another. */}
      {!running && failed && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{runLog}</p>
      )}

      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 dark:border-slate-700">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Also show in plots
          </span>
          {pinned.map(c => (
            <span key={c}
              title={`${c} is part of the comparison, so it is always shown`}
              className="rounded-md border border-indigo-400 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {c}
              <span className="ml-1 opacity-60" aria-hidden="true">◆</span>
            </span>
          ))}
          {others.map(c => {
            const on = extras.includes(c)
            return (
              <button
                key={c}
                onClick={() => onExtras(on ? extras.filter(g => g !== c) : [...extras, c])}
                aria-pressed={on}
                title={`${c} — shown in gene expression, the heatmap and gene-set activity only`}
                className={`pressable rounded-md border px-2 py-0.5 text-xs transition ${on
                  ? 'border-slate-400 bg-white font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-100'
                  : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700'}`}
              >{c}</button>
            )
          })}
          <span className="ml-auto flex items-center gap-1.5">
            <button className="btn py-0.5 text-xs" onClick={() => onExtras(others)}>All</button>
            <button className="btn py-0.5 text-xs" onClick={() => onExtras([])}>None</button>
          </span>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        {pinned.length > 0 && '◆ is the pair being tested and is always drawn. '}
        These change only the per-sample views — gene expression, the heatmap, gene-set activity
        and the PCA — never the statistics.
      </p>
    </div>
  )
}

/**
 * Where this comparison's numbers come from, and how many samples are behind
 * them.
 *
 * The replicate counts are on the badge because they are the single most useful
 * thing to know about a comparison before reading it, and because they were
 * previously discoverable only by hovering a chip.
 */
function Provenance({ c, bundle }: { c: Comparison; bundle: Bundle }) {
  const contrast = bundle.meta.contrasts.find(x => x.id === c.id)
  const n = contrast?.n_deg
  if (c.source === 'unavailable') {
    return <span className="pill bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      no results
    </span>
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={`pill ${c.source === 'computed'
        ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200'
        : c.source === 'bundle'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
        {c.source === 'bundle' ? 'DESeq2 · from your pipeline'
          : c.source === 'computed' ? 'DESeq2 · run here'
            : 'not computed yet'}
      </span>
      {c.source === 'bundle' && typeof n === 'number' && (
        <span className="text-xs text-slate-500">
          {n.toLocaleString()} DEGs · padj &lt; {contrast?.padj_threshold ?? 0.05},
          |log2FC| ≥ {contrast?.lfc_threshold ?? 1}
        </span>
      )}
      {c.groupsAreConditions && (
        <span className="text-xs text-slate-400">
          {c.nNumerator} vs {c.nDenominator} samples
          {Math.min(c.nNumerator, c.nDenominator) < MIN_REPLICATES && ' — too few to model'}
        </span>
      )}
    </span>
  )
}
