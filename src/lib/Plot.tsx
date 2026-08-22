import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'

interface PlotProps {
  data: any[]
  layout?: any
  config?: any
  className?: string
  style?: React.CSSProperties
  onPointClick?: (point: any) => void
  downloadName?: string   // when set, shows a "⭳ PNG" button and names the export
}

/**
 * `title: 'text'` → `title: { text: 'text' }`, everywhere in a spec.
 *
 * Plotly 3 dropped the bare-string form for titles, and it dropped it SILENTLY:
 * the string is ignored, no warning is logged, and the plot renders perfectly —
 * just with no axis label. Every figure in this app was drawn that way, so the
 * volcano had no "log2 fold change", the module score no "module score", the
 * enrichment bars no "gene ratio", and the PCA — where the axis label carries
 * the percent variance, the number the figure is for — had nothing at all.
 * Exported PNGs went into people's slide decks with bare numbers on the axes.
 *
 * Normalised here rather than at the twenty call sites, because a fix that has
 * to be remembered is a fix that regresses the next time somebody adds a chart.
 * The object form is accepted for every title Plotly has, so this is a widening
 * conversion and never changes a spec that was already correct.
 */
function withTitles<T>(spec: T): T {
  if (Array.isArray(spec)) return spec.map(withTitles) as unknown as T
  if (!spec || typeof spec !== 'object') return spec
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec as Record<string, unknown>)) {
    out[k] = k === 'title' && typeof v === 'string' ? { text: v } : withTitles(v)
  }
  return out as T
}

// Thin React wrapper over plotly.js-dist-min. Calls Plotly.react on prop change,
// binds click events, purges on unmount, and offers a high-res PNG download.
export default function Plot({ data, layout, config, className, style, onPointClick, downloadName }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick

  useEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      Plotly.react(el, withTitles(data), withTitles(layout ?? {}), {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        toImageButtonOptions: { format: 'png', filename: downloadName || 'plot', scale: 2 },
        ...config,
      })
    } catch (err) {
      // Never let a single plot failure bubble up and blank the app.
      console.error('[Plot] render failed:', err)
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:.85rem">This chart could not be rendered.</div>'
    }
  }, [data, layout, config, downloadName])

  useEffect(() => {
    const el = ref.current as any
    if (!el) return
    const handler = (e: any) => { if (clickRef.current && e?.points?.[0]) clickRef.current(e.points[0]) }
    el.on?.('plotly_click', handler)
    return () => el.removeAllListeners?.('plotly_click')
  }, [])

  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])

  const download = () => {
    const el = ref.current
    if (!el) return
    Plotly.downloadImage(el, {
      format: 'png', filename: downloadName || 'plot', scale: 2,
      width: el.clientWidth || 1000, height: el.clientHeight || 500,
    })
  }

  return (
    <div>
      {downloadName && (
        <div className="mb-1 flex justify-end">
          <button onClick={download} title="Download this graph as PNG"
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            ⭳ PNG
          </button>
        </div>
      )}
      {/* The container must follow layout.height, or a tall plot (faceted panels,
          a long heatmap) draws past a fixed-height div and overlaps what follows. */}
      <div
        ref={ref}
        className={className}
        style={{ width: '100%', height: typeof layout?.height === 'number' ? layout.height : 440, ...style }}
      />
    </div>
  )
}
