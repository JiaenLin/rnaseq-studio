// The order the groups are drawn in.
//
// Ported from scrnaseq-studio, where the same problem has already been solved
// once and the reasoning is worth repeating: the order the groups arrive in is
// the order the exporter wrote meta.conditions, and that is the right DEFAULT —
// `Ctrl_Cold, Ctrl_Thermo, KO_Cold, KO_Thermo` is a design, and sorting it
// alphabetically would destroy it. It is just not always the order the reader
// wants on the page. A control added to the bundle last still has to sit first
// on the axis, and a time course exported out of order reads backwards.
//
// This studio arranged them by SIDE instead — control, then compare, then the
// rest — which is a sensible default and not a choice. A reader who wanted the
// untreated arm in the middle of a dose series, or the timepoints in time
// order, had no way to say so.
//
// A VIEW, NOT AN EDIT. Nothing is recomputed and no number moves. Every group
// below this line is identified by its NAME — `orderSamples` looks conditions
// up by name, `comparisonKey` is built from the group names on each side, the
// DESeq2 request names its levels — so permuting one array is safe in a way
// that permuting anything the statistics read would not be. That is why this
// file permutes `GroupSel.order` and touches nothing else.

/**
 * `all`, reordered to follow `order`.
 *
 * Names in `order` that this bundle does not have are ignored, and names the
 * bundle has that `order` does not mention keep their own relative order at the
 * end — so an order left over from a different bundle degrades to "the ones I
 * recognise first", never to a group silently vanishing from the axis.
 *
 * Returns the ORIGINAL array when the result would equal it, so an unreordered
 * selection stays referentially identical and every memo keyed on it holds.
 */
export function orderedBy(all: readonly string[], order: readonly string[]): string[] {
  if (!order.length) return all as string[]
  const rank = new Map<string, number>()
  order.forEach((name, i) => { if (!rank.has(name)) rank.set(name, i) })
  const out = all
    .map((name, i) => ({ name, i, r: rank.get(name) ?? Infinity }))
    // Stable within each band, so the groups the reader has not placed keep the
    // arrangement the bundle gave them.
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.name)
  return out.every((name, i) => name === all[i]) ? (all as string[]) : out
}

/** `list` with the item at `from` moved to `to`. Out-of-range moves are no-ops. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list as T[]
  }
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}
