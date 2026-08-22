import type { Bundle } from '../types'
import type { ComparisonState } from '../lib/contrast'
import type { GroupSel } from '../lib/design'
import { conditionSizes } from '../lib/contrast'
import { sideLabel } from '../lib/design'

/**
 * Pick both sides. Whether the answer already exists is a property of it.
 *
 * This was a menu of the contrasts the pipeline exported, and the menu was the
 * problem: it made the exporter's choices the app's choices. A pair nobody
 * exported was a pair you could not ask about, and a question the design
 * supports — the main effect of genotype across both temperatures on a 2x2 —
 * did not exist here at all, because no single pairwise contrast is it.
 *
 * So the reader picks the groups on each side, freely, and either side may hold
 * more than one. What "precomputed" means shrinks to what it always should have
 * been: if the pipeline happened to export exactly this pair, its table is what
 * is shown and the badge says so. Otherwise DESeq2 runs here on the raw counts.
 * Both are DESeq2; neither is a lesser answer.
 */
export default function ComparisonBar({
  bundle, sel, state, running, runLog, onSel, onRun,
}: {
  bundle: Bundle
  sel: GroupSel
  state: ComparisonState
  running: boolean
  /** Progress or failure for THIS pair only — see App's run state. */
  runLog: string
  onSel: (next: GroupSel) => void
  onRun: () => void
}) {
  const sizes = conditionSizes(bundle)
  const all = bundle.meta.conditions.filter(c => sizes.has(c))
  const failed = runLog.startsWith('Failed')

  /**
   * A group can be on one side or the other, never both.
   *
   * Moving it rather than refusing it: clicking KO_Cold under Control when it is
   * already under Compare means "I want it as the control", and making the
   * reader clear the other side first is a rule with nothing behind it.
   */
  const put = (group: string, side: 'control' | 'test' | 'extra') => {
    const strip = (xs: string[]) => xs.filter(g => g !== group)
    const next: GroupSel = {
      control: strip(sel.control), test: strip(sel.test), extra: strip(sel.extra),
      excluded: sel.excluded,
    }
    next[side] = [...next[side], group]
    onSel(next)
  }

  const sideOf = (g: string): 'control' | 'test' | 'extra' =>
    sel.control.includes(g) ? 'control' : sel.test.includes(g) ? 'test' : 'extra'

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {/* Control first, then compare — the order the experiment is
              described in, and the order the reader decides in: you know what
              the baseline is before you know what you are holding against it. */}
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Control
          </div>
          <GroupRow all={all} sizes={sizes} sideOf={sideOf} want="control" onPut={put} />
          <div className="mb-1.5 mt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Compare
          </div>
          <GroupRow all={all} sizes={sizes} sideOf={sideOf} want="test" onPut={put} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Provenance state={state} />
          {state.source === 'computable' && (
            <button className="btn btn-primary py-1 text-xs" disabled={running} onClick={onRun}>
              {running ? 'Running DESeq2…' : 'Run DESeq2 for this pair'}
            </button>
          )}
          {running && <span className="text-xs text-slate-400">{runLog}</span>}
        </div>
      </div>

      <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-700">
        <b>{sideLabel(sel.test)}</b> vs <b>{sideLabel(sel.control)}</b>
        {' · '}{state.nTest} vs {state.nControl} samples
        {sel.excluded.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {' · '}{sel.excluded.length} sample{sel.excluded.length === 1 ? '' : 's'} excluded
            on the Overview tab
          </span>
        )}
        {(sel.control.length > 1 || sel.test.length > 1) && (
          <> &middot; a side holding several groups is <b>pooled</b> into one level, which asks for
            their shared effect rather than any one pairwise difference</>
        )}
      </p>

      {state.source === 'unavailable' && state.blocked && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">{state.blocked}</p>
      )}

      {/* A precomputed table came from the pipeline's own run, over the samples
          the pipeline was given. It cannot honour an exclusion made here, and
          not saying so would let a reader believe an exclusion had an effect it
          did not have. */}
      {state.source === 'bundle' && sel.excluded.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          These statistics came from your pipeline and were computed over <b>all</b> samples — the{' '}
          {sel.excluded.length} you excluded {sel.excluded.length === 1 ? 'is' : 'are'} in them.
          Run DESeq2 here if you need the comparison without{' '}
          {sel.excluded.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {!running && failed && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{runLog}</p>
      )}
    </div>
  )
}

/** One row of group chips, each showing whether it is on this side. */
function GroupRow({ all, sizes, sideOf, want, onPut }: {
  all: string[]
  sizes: Map<string, number>
  sideOf: (g: string) => 'control' | 'test' | 'extra'
  want: 'control' | 'test'
  onPut: (g: string, side: 'control' | 'test' | 'extra') => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.map(g => {
        const side = sideOf(g)
        const on = side === want
        const elsewhere = side !== want && side !== 'extra'
        return (
          <button
            key={g}
            aria-pressed={on}
            // On this side already -> take it off, back to shown-only. Otherwise
            // put it here, wherever it was.
            onClick={() => onPut(g, on ? 'extra' : want)}
            title={elsewhere
              ? `${g} is on the other side — click to move it here`
              : on ? `${g} — click to take it out of the comparison`
                : `${g} — click to add it to this side`}
            className={`pressable rounded-md border px-2 py-0.5 text-xs transition ${on
              ? want === 'control'
                ? 'border-slate-500 bg-white font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100'
                : 'border-indigo-400 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
              : elsewhere
                ? 'border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-600'
                : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700'}`}
          >
            {g}<span className="ml-1 opacity-60">{sizes.get(g) ?? 0}</span>
          </button>
        )
      })}
    </div>
  )
}

function Provenance({ state }: { state: ComparisonState }) {
  const n = state.contrast?.n_deg
  if (state.source === 'unavailable') {
    return <span className="pill bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      no result
    </span>
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span className={`pill ${state.source === 'computed'
        ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200'
        : state.source === 'bundle'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'
          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
        {state.source === 'bundle' ? 'DESeq2 · from your pipeline'
          : state.source === 'computed' ? 'DESeq2 · run here'
            : 'not computed yet'}
      </span>
      {state.source === 'bundle' && typeof n === 'number' && (
        <span className="text-xs text-slate-500">{n.toLocaleString()} DEGs</span>
      )}
    </span>
  )
}
