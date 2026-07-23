import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'

interface PlotProps {
  data: any[]
  layout?: any
  config?: any
  className?: string
  style?: React.CSSProperties
  onPointClick?: (point: any) => void
}

// Thin, dependency-light React wrapper over plotly.js-dist-min. We call
// Plotly.react on every prop change (it diffs internally) and bind click events
// against the graph div. Purge on unmount to release WebGL/canvas contexts.
export default function Plot({ data, layout, config, className, style, onPointClick }: PlotProps) {
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
      ...config,
    })
  }, [data, layout, config])

  useEffect(() => {
    const el = ref.current as any
    if (!el) return
    const handler = (e: any) => {
      if (clickRef.current && e?.points?.[0]) clickRef.current(e.points[0])
    }
    el.on?.('plotly_click', handler)
    return () => el.removeAllListeners?.('plotly_click')
  }, [])

  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])

  return <div ref={ref} className={className} style={{ width: '100%', height: 440, ...style }} />
}
