import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseSets, type Collection } from '../lib/msigdb.ts'

/**
 * Paste your own gene sets in, in whatever you have them in.
 *
 * This replaced a file picker labelled "Add a GMT…", which was the one control
 * in the studio that asked the reader to go and produce a file in a format they
 * do not work in. Nobody keeps their signatures as tab-separated triples; they
 * keep them as the dict they built the analysis with, in the notebook or the R
 * script that made the counts — one keystroke from the clipboard. So the
 * control is a text box, and the parser meets the input where it is; see
 * `parseSets`.
 *
 * The thing that makes it usable is not the box, it is the panel underneath:
 * every set that was found, how many of its genes this bundle actually
 * measured, and which ones it did not, BEFORE anything is added. A silent parse
 * is the failure mode of every "paste your data here" box ever built — it reads
 * three sets out of your twelve and tells you it worked. This says what it
 * understood and lets the reader see it was wrong while it is still one edit
 * away from right.
 */
export default function SetEditor({ open, background, initial, onClose, onAdd }: {
  open: boolean
  /**
   * The genes this contrast tested, to say what is measured before anything is
   * added.
   *
   * The DEG table's own gene list, not a genome: a set whose members were
   * filtered out by the pipeline's independent filtering is a set this bundle
   * cannot answer for, and the reader should learn that here rather than from a
   * K that is smaller than they expected.
   */
  background: readonly string[]
  /**
   * A collection to open FOR EDITING, written back out as text.
   *
   * Without it the only thing to do with a collection already added was remove
   * it and paste the whole thing again — so fixing one typed symbol in a set of
   * ninety meant retyping ninety. `collectionToText` is the other half; the
   * parser reads its own output back.
   */
  initial?: { name: string; text: string } | null
  onClose: () => void
  onAdd: (c: Collection) => void
}) {
  const [text, setText] = useState('')
  const [name, setName] = useState('My sets')
  const box = useRef<HTMLTextAreaElement>(null)

  // Seeded when the dialog OPENS, not on every render: the fields are the
  // reader's while it is open, and re-seeding under them would undo typing.
  useEffect(() => {
    if (!open) return
    setText(initial?.text ?? '')
    setName(initial?.name ?? 'My sets')
    // `initial` is read once, on the transition to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose])

  /**
   * What the paste says, re-read on every keystroke.
   *
   * Cheap enough to do live — the input is a few hundred lines, not a count
   * matrix — and being live is the point: the reader watches the count settle
   * as they finish pasting, rather than pressing Add and finding out.
   */
  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { ok: parseSets(text, name.trim() || 'My sets'), error: null as string | null }
    } catch (e) {
      return { ok: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, name])

  /** How much of each set this bundle can actually answer for. */
  const coverage = useMemo(() => {
    const c = parsed?.ok
    if (!c) return null
    const bg = new Set<string>()
    for (const g of background) bg.add(g.toUpperCase())
    const rows = c.sets.map(s => {
      const genes = Array.from(s.genes, i => c.symbols[i])
      const missing = genes.filter(g => !bg.has(g.toUpperCase()))
      return { name: s.name, n: genes.length, missing }
    })
    return {
      rows,
      total: rows.reduce((a, r) => a + r.n, 0),
      found: rows.reduce((a, r) => a + (r.n - r.missing.length), 0),
    }
  }, [parsed, background])

  if (!open) return null

  const empty = !text.trim()
  const nSets = parsed?.ok?.sets.length ?? 0

  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4"
      // A click on the backdrop closes; a click inside must not. Checking the
      // target rather than stopping propagation on the panel, because the panel
      // holds a textarea and swallowing its events breaks selection.
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Add your own gene sets"
        className="modal-panel card my-8 w-full max-w-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Gene sets · your own
            </div>
            <h2 className="text-lg font-semibold">Paste your gene sets</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              A Python or R dict, JSON, a GMT,{' '}
              <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">Name: gene, gene</code>{' '}
              lines, or a plain list of genes for one set. Nothing is uploaded.
            </p>
          </div>
          <button className="btn py-1" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Collection name</span>
            <input className="input w-56 py-1" value={name} aria-label="Collection name"
              onChange={e => setName(e.target.value)} />
            <span className="flex-1" />
            <label className="btn cursor-pointer py-1">
              or read a file…
              <input
                type="file" accept=".gmt,.txt,.tsv,.json,.csv,.py,.R" className="sr-only"
                onChange={async e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setText(await f.text())
                  setName(f.name.replace(/\.[^.]+$/, '') || 'My sets')
                }}
              />
            </label>
          </div>

          <textarea
            ref={box}
            className="input mt-2 block h-60 w-full resize-y font-mono text-xs"
            spellCheck={false}
            // Not "Gene sets": the tab panel behind this dialog already has that
            // accessible name, so the two were indistinguishable to anything
            // matching on it — a screen reader included.
            aria-label="Your gene sets"
            placeholder={'pathway_genes = {\n    "TCA cycle": ["Cs", "Aco2", "Idh2", "Mdh2"],\n    "Glycolysis": ["Hk1", "Gpi1", "Aldoa", "Pkm"],\n}'}
            value={text}
            onChange={e => setText(e.target.value)}
          />

          {/* What was understood, before anything is added. */}
          {parsed?.error && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {parsed.error}
            </p>
          )}
          {coverage && parsed?.ok && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Understood</span>
                <span><b>{nSets}</b> set{nSets === 1 ? '' : 's'}</span>
                <span>
                  <b>{coverage.found}</b> of {coverage.total} genes were tested in this contrast
                </span>
                {coverage.found === 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    none of them — check the species and capitalisation
                  </span>
                )}
              </div>
              <div className="mt-2 max-h-48 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-2 py-1.5">Set</th>
                      <th className="px-2 py-1.5 text-right">Genes</th>
                      <th className="px-2 py-1.5">Not tested here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.rows.map(r => (
                      <tr key={r.name} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 text-right font-mono">{r.n - r.missing.length} / {r.n}</td>
                        <td className="px-2 py-1 font-mono text-xs text-slate-400">
                          {r.missing.length === 0 ? '—'
                            : r.missing.slice(0, 6).join(', ')
                              + (r.missing.length > 6 ? ` +${r.missing.length - 6}` : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-5 dark:border-slate-800">
          <span className="text-xs text-slate-400">
            Read in this page, like every other file this studio opens. Not kept between sessions.
          </span>
          <span className="flex items-center gap-2">
            <button className="btn py-1" onClick={() => setText('')} disabled={empty}>Clear</button>
            <button
              className="btn btn-primary py-1"
              disabled={!parsed?.ok}
              onClick={() => {
                if (!parsed?.ok) return
                onAdd(parsed.ok)
                setText('')
                onClose()
              }}
            >{nSets ? `Add ${nSets} set${nSets === 1 ? '' : 's'}` : 'Add'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
