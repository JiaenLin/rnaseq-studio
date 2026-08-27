// Tick labels for a categorical chart axis.
//
// Pure string work, kept out of Plot.tsx because that file is JSX and Node's
// type-stripping will not load a .tsx — so anything living there cannot be
// tested, and these two functions are exactly the kind that need to be.

/** Characters per line before a tick label wraps. */
const TICK_WIDTH = 40
/**
 * Lines a tick label may occupy before it is elided.
 *
 * The row height is a constant per bar and the label wraps to as many lines as
 * it needs, so a term like "Adaptive immune response based on somatic
 * recombination of immune receptors built from immunoglobulin superfamily
 * domains" took four lines in a 26-pixel row and printed straight through the
 * names above and below it. Two is what a row can hold; past that the name is
 * cut, and the full one is in the hover.
 */
const TICK_LINES = 2

/**
 * Y-axis tick labels for a horizontal bar chart: wrapped, elided, and UNIQUE.
 *
 * Unique matters and is not obvious. Plotly's category axis is keyed by the
 * label STRING, so two sets whose names agree for their first eighty characters
 * — which MSigDB's GO terms do constantly — elide to one string, become one
 * category, and one of the two bars silently vanishes. A zero-width space keeps
 * them apart and is invisible in the figure and in the exported PNG.
 */
export function tickLabels(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(n => {
    const base = wrapLabel(n, TICK_WIDTH, TICK_LINES)
    const k = seen.get(base) ?? 0
    seen.set(base, k + 1)
    return k ? base + '\u200B'.repeat(k) : base
  })
}

/** Rows a bar needs, from the tallest label actually drawn. */
export const tickRows = (labels: readonly string[]): number =>
  Math.max(1, ...labels.map(l => l.split('<br>').length))

/**
 * Word-wrap to `width` per line, breaking on _ / - and spaces and hard-wrapping
 * a single run that is still too long. At most `maxLines`; the last one is
 * elided rather than dropped, so a cut name looks cut.
 */
export function wrapLabel(s: string, width = TICK_WIDTH, maxLines = TICK_LINES): string {
  if (s.length <= width) return s
  const lines: string[] = []
  let line = ''
  for (const tok of s.split(/(?=[_/\- ])/)) {
    if (line && (line + tok).length > width) { lines.push(line); line = tok.replace(/^[_/\- ]/, '') }
    else line += tok
  }
  if (line) lines.push(line)
  const hard = lines.flatMap(l =>
    (l.length <= width ? [l] : (l.match(new RegExp(`.{1,${width}}`, 'g')) || [l])))
  if (hard.length <= maxLines) return hard.join('<br>')
  const kept = hard.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, width - 1)).trimEnd()}…`
  return kept.join('<br>')
}

