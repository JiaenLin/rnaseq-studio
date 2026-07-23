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

// Thin React wrapper over plotly.js-dist-min. Calls Plotly.react on prop change,
// binds click events, purges on unmount, and offers a high-res PNG download.
export default function Plot({ data, layout, config, className, style, onPointClick, downloadName }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick

  useEffect(() => {
    const el = ref.current
    if (!el) return
    Plotly.react(el, data, layout ?? {}, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      toImageButtonOptions: { format: 'png', filename: downloadName || 'plot', scale: 2 },
      ...config,
    })
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
      <div ref={ref} className={className} style={{ width: '100%', height: 440, ...style }} />
    </div>
  )
}
