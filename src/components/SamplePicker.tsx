import { useMemo } from 'react'
import type { Bundle } from '../types'
import type { GroupSel } from '../lib/design'
import { conditionColors } from '../lib/palette'

/**
 * Which samples take part in everything downstream.
 *
 * A group can be taken out of a comparison from the bar above; a SAMPLE could
 * not be taken out of anything at all. A failed library, an animal that turned
 * out to be the wrong genotype, an outlier the PCA has just put on its own in a
 * corner — until now the only way to drop one was to edit the bundle and reload
 * it, so in practice nobody did, and the outlier stayed in every mean.
 *
 * What an exclusion reaches is worth being exact about, because it is not
 * everything:
 *
 *   it does     the PCA, the sample check, gene expression, the heatmap,
 *               gene-set activity, and any DESeq2 run performed here
 *   it does not a differential expression table your pipeline exported — that
 *               was computed elsewhere, over the samples the pipeline was given,
 *               and nothing in this app can retroactively remove one from it
 *
 * The bar says so whenever a precomputed table is on screen with an exclusion
 * active, rather than letting the exclusion look more powerful than it is.
 */
export default function SamplePicker({ bundle, sel, onSel }: {
  bundle: Bundle
  sel: GroupSel
  onSel: (next: GroupSel) => void
}) {
  const colors = conditionColors(bundle.meta.conditions)
  const excluded = useMemo(() => new Set(sel.excluded), [sel.excluded])

  /** Samples the matrix actually has, grouped by condition, in bundle order. */
  const byGroup = useMemo(() => {
    const cond = new Map(bundle.samples.map(s => [s.sample, s.condition]))
    const m = new Map<string, string[]>()
    for (const name of bundle.counts.samples) {
      const g = cond.get(name) ?? '—'
      const list = m.get(g) ?? []
      list.push(name)
      m.set(g, list)
    }
    // meta.conditions order first, then anything the sheet has that it does not.
    const ordered: [string, string[]][] = []
    for (const g of bundle.meta.conditions) if (m.has(g)) ordered.push([g, m.get(g)!])
    for (const [g, list] of m) if (!bundle.meta.conditions.includes(g)) ordered.push([g, list])
    return ordered
  }, [bundle])

  const setExcluded = (names: string[]) => onSel({ ...sel, excluded: names })
  const toggle = (name: string) =>
    setExcluded(excluded.has(name)
      ? sel.excluded.filter(s => s !== name)
      : [...sel.excluded, name])
  const toggleGroup = (list: string[]) => {
    const allOut = list.every(s => excluded.has(s))
    setExcluded(allOut
      ? sel.excluded.filter(s => !list.includes(s))
      : [...new Set([...sel.excluded, ...list])])
  }

  const nIn = bundle.counts.samples.length - excluded.size

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="mr-auto text-sm font-semibold uppercase tracking-wide text-slate-500">
          Samples in the analysis
        </h3>
        <span className="text-xs text-slate-500">
          <b>{nIn}</b> of {bundle.counts.samples.length} included
        </span>
        {excluded.size > 0 && (
          <button className="btn py-0.5 text-xs" onClick={() => setExcluded([])}>
            Include all
          </button>
        )}
      </div>

      <div className="space-y-2">
        {byGroup.map(([group, list]) => {
          const outCount = list.filter(s => excluded.has(s)).length
          const allOut = outCount === list.length
          return (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => toggleGroup(list)}
                title={allOut ? `Bring ${group} back in` : `Take all of ${group} out`}
                className="pressable mr-1 w-40 shrink-0 truncate rounded-md border px-2 py-0.5 text-left text-xs font-medium"
                style={{
                  borderColor: colors[group] ?? '#cbd5e1',
                  background: allOut ? 'transparent' : (colors[group] ?? '#94a3b8') + '1f',
                  color: allOut ? '#94a3b8' : colors[group] ?? '#475569',
                  textDecoration: allOut ? 'line-through' : 'none',
                }}
              >
                {group}
                <span className="ml-1 opacity-70">{list.length - outCount}/{list.length}</span>
              </button>
              {list.map(name => {
                const out = excluded.has(name)
                return (
                  <button
                    key={name}
                    aria-pressed={!out}
                    onClick={() => toggle(name)}
                    title={out ? `${name} — excluded, click to include` : `${name} — click to exclude`}
                    className={`pressable rounded px-1.5 py-0.5 font-mono text-[11px] transition ${out
                      ? 'border border-dashed border-slate-300 text-slate-300 line-through dark:border-slate-700 dark:text-slate-600'
                      : 'border border-slate-200 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300'}`}
                  >{name}</button>
                )
              })}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Excluding a sample removes it from the PCA, the sample check, gene expression, the
        heatmap, gene-set activity, and any DESeq2 run performed here. It <b>cannot</b> remove it
        from a differential expression table your pipeline exported — that was computed elsewhere,
        over the samples the pipeline was given. Run DESeq2 here for a comparison that honours the
        exclusion.
      </p>
    </div>
  )
}
