import type { Bundle } from '../types'

interface Props {
  bundle: Bundle
  onOpenContrast: (contrastId: string) => void
}

export default function Overview({ bundle, onOpenContrast }: Props) {
  const { meta, samples, counts, degByContrast } = bundle

  const degCount = (id: string, thr: number) =>
    (degByContrast[id] || []).filter(r => r.padj != null && r.padj < thr).length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Project" value={meta.project} />
        <Metric label="Species" value={meta.species} />
        <Metric label="Samples" value={String(samples.length)} sub={`${counts.geneIds.length.toLocaleString()} genes`} />
        <Metric label="Reference / control" value={meta.control} sub={`engine: ${meta.engine}`} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Contrasts</h3>
        <div className="space-y-2">
          {meta.contrasts.map(c => {
            const thr = c.padj_threshold ?? 0.05
            const n = c.n_deg ?? degCount(c.id, thr)
            return (
              <button key={c.id} onClick={() => onOpenContrast(c.id)}
                className="pressable flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5 text-left hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:hover:bg-slate-800">
                <span className="font-medium">{c.label}</span>
                <span className="text-sm text-slate-500">
                  <span className="font-mono font-semibold text-indigo-600">{n.toLocaleString()}</span> DEGs · padj &lt; {thr}
                </span>
              </button>
            )
          })}
        </div>
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
      <div className="mt-1 truncate text-lg font-semibold" title={value}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}
