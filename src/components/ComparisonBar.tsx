import type { Bundle } from '../types'
import type { ComparisonState } from '../lib/contrast'
import type { GroupSel } from '../lib/design'
import type { Shrink } from '../lib/deseq'
import { conditionSizes } from '../lib/contrast'
import { displayOrder, sideLabel } from '../lib/design'
import { moveItem } from '../lib/order'

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
  bundle, sel, state, running, runLog, onSel, onRun, onCrossBlock, shrink = 'none', onShrink,
}: {
  bundle: Bundle
  sel: GroupSel
  state: ComparisonState
  running: boolean
  /** Progress or failure for THIS pair only — see App's run state. */
  runLog: string
  onSel: (next: GroupSel) => void
  onRun: () => void
  /** Take the reader to the view that DOES answer a cross-block question. */
  onCrossBlock?: () => void
  /** Shrinkage for a run performed here. apeglm or nothing; never ashr. */
  shrink?: Shrink
  onShrink?: (s: Shrink) => void
}) {
  // After exclusions, so a chip can never disagree with the summary line below it.
  const sizes = conditionSizes(bundle, sel.excluded)
  const total = conditionSizes(bundle)
  const all = bundle.meta.conditions.filter(c => (total.get(c) ?? 0) > 0)
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
      order: sel.order, excluded: sel.excluded,
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
          {(state.source === 'computable' || state.canRun) && (
            <>
              <button
                className={`btn py-1 text-xs ${state.source === 'bundle' ? '' : 'btn-primary'}`}
                disabled={running} onClick={onRun}>
                {running ? 'Running DESeq2…'
                  : state.source === 'bundle'
                    // The pipeline already answered this pair. Re-running is for
                    // asking it again under a different shrinkage setting, or
                    // for checking the bundle's numbers against a fresh fit —
                    // so the button says that rather than pretending nothing
                    // exists yet.
                    ? `Re-run here${shrink === 'none' ? ' (MLE)' : ' with apeglm'}`
                    : state.hiddenPrecomputed
                      ? 'Re-run without the excluded samples'
                      : 'Run DESeq2 for this pair'}
              </button>
              {/* Shown beside the button because it changes what that button
                  produces. Two options and no more: ashr is not offered here or
                  anywhere. Default none, so a run matches what the pipeline's
                  own tables report unless the reader asks otherwise. */}
              {onShrink && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  shrinkage
                  <select className="input py-0.5 text-[11px]" value={shrink} disabled={running}
                    onChange={e => onShrink(e.target.value as Shrink)}>
                    <option value="none">none (MLE)</option>
                    <option value="apeglm">apeglm</option>
                  </select>
                </label>
              )}
            </>
          )}
          {running && <span className="text-xs text-slate-400">{runLog}</span>}
        </div>
      </div>

      {/* The order every figure draws these in. Here rather than on a tab
          because it moves all of them at once, and a control that lives on one
          figure is a setting you change in one place and go somewhere else to
          see. Collapsed, because most bundles never need it. */}
      <GroupOrder sel={sel} onSel={onSel} />

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

      {state.source === 'bundle' && state.canRun && (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Showing your pipeline&rsquo;s table
          {bundle.meta.shrinkage
            ? <>, whose fold changes are <b>{bundle.meta.shrinkage === 'none'
              ? 'the maximum likelihood estimate' : bundle.meta.shrinkage}</b></>
            : null}. A re-run here is filed separately, so both stay available and the Overlap tab
          can hold them side by side.
        </p>
      )}

      {state.source === 'unavailable' && state.blocked && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">{state.blocked}</p>
      )}

      {/* NOT a refusal. The pair spans two fits, so no contrast exists for it
          and none can be run — but the question behind it is answerable, and
          saying only "unavailable" would leave the reader thinking the app had
          run out of road when it has a whole tab for this. */}
      {state.source === 'cross-block' && (
        <p className="mt-1.5 text-xs leading-relaxed text-indigo-700 dark:text-indigo-300">
          These two groups are in different <b>{bundle.meta.block_factor}</b> levels, which were
          fitted separately — so no single model compares them, and running one here would pool a
          dispersion across samples that are not comparable. What you can ask is whether the two
          respond the <b>same way</b>: put the same comparison side by side in each and test the
          difference between the fold changes.
          {onCrossBlock && (
            <button className="btn btn-primary ml-2 py-0.5 text-xs" onClick={onCrossBlock}>
              Compare across blocks
            </button>
          )}
        </p>
      )}

      {/* A precomputed table came from the pipeline's own run, over the samples
          the pipeline was given. It cannot honour an exclusion made here, and
          not saying so would let a reader believe an exclusion had an effect it
          did not have. */}
      {/* The pipeline's table for this pair exists and is being withheld,
          because it was computed over samples the reader has taken out. Said
          here, in full, so the empty tabs are explained rather than puzzling —
          and only when the exclusion actually touches THIS comparison, since
          an excluded Ctrl_Cold sample changes nothing about KO_Thermo vs
          KO_Cold. */}
      {state.hiddenPrecomputed && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          <b>Your pipeline&rsquo;s result for this pair is hidden.</b> It was computed over all
          samples, including {state.staleExclusions!.join(', ')} — so it does not describe what you
          have selected, and showing it beside a warning is how a screenshot ends up in a slide
          without one.
          {state.canRun
            ? ' Re-run it here without them, or bring them back on the Overview tab.'
            : ' Bring them back on the Overview tab to see it again.'}
        </p>
      )}

      {!running && failed && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{runLog}</p>
      )}
    </div>
  )
}

/**
 * The order the groups are drawn in, for every figure at once.
 *
 * Up and down rather than drag. A drag target is a mouse-only affordance and
 * these are buttons a keyboard reaches; with the four or five arms a real design
 * has, two clicks put any group anywhere.
 */
function GroupOrder({ sel, onSel }: { sel: GroupSel; onSel: (next: GroupSel) => void }) {
  const shown = displayOrder(sel)
  if (shown.length < 3) return null      // two groups have one sensible order

  const move = (from: number, to: number) => {
    const next = moveItem(shown, from, to)
    if (next !== shown) onSel({ ...sel, order: next })
  }

  return (
    <details className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-indigo-600">
        Figure order{sel.order.length > 0 && <span className="ml-1 text-indigo-500">·</span>}
        <span className="ml-1.5 text-slate-400">{shown.join(' → ')}</span>
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {shown.map((g, i) => (
          <span key={g}
            className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white pl-2 text-xs dark:border-slate-700 dark:bg-slate-800">
            <span className="mr-0.5">{g}</span>
            <button className="pressable px-1 py-0.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
              disabled={i === 0} aria-label={`Move ${g} earlier`} title="Move earlier"
              onClick={() => move(i, i - 1)}>←</button>
            <button className="pressable px-1 py-0.5 pr-1.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
              disabled={i === shown.length - 1} aria-label={`Move ${g} later`} title="Move later"
              onClick={() => move(i, i + 1)}>→</button>
          </span>
        ))}
        <button className="btn ml-1 py-0.5 text-xs" disabled={!sel.order.length}
          onClick={() => onSel({ ...sel, order: [] })}>
          Bundle order
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Every figure that splits by group follows this. Nothing is recomputed — Control and
        Compare are chosen by name and do not move.
      </p>
    </details>
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
  if (state.source === 'cross-block') {
    // "no result" would be a lie by omission: there is no CONTRAST, but there
    // is an answer, one tab away.
    return <span className="pill bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
      across blocks
    </span>
  }
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
