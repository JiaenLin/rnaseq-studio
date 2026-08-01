import type { Bundle } from '../types'

interface Props {
  bundle: Bundle
}

// Contrasts are chosen in the comparison bar above the tabs, so this no longer
// lists them — it describes the dataset.
export default function Overview({ bundle }: Props) {
  const { meta, samples, counts } = bundle

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Project" value={meta.project} />
        <Metric label="Species" value={meta.species} />
        <Metric label="Samples" value={String(samples.length)} sub={`${counts.geneIds.length.toLocaleString()} genes`} />
        <Metric label="Reference / control" value={meta.control} sub={`engine: ${meta.engine}`} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Samples</h3>
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>{Object.keys(samples[0] || { sample: '', condition: '' }).map(k =>
                <th key={k} className="px-3 py-2">{k}</th>)}</tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                  {Object.values(s).map((v, j) => <td key={j} className="px-3 py-1.5 font-mono">{String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      {/* Wraps rather than truncating — the project name is often the only thing
          identifying whose data this is, and "Ferroptosis combinatori…" is not. */}
      <div className="mt-1 break-words text-lg font-semibold leading-snug" title={value}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}
