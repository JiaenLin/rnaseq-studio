// The isoform layer's maths, kept out of the component so it can be tested.
//
// Two questions long reads answer and short reads do not:
//
//   DTE — is this isoform present at a different LEVEL?
//   DTU — did the gene's isoform MIX change? A gene can be perfectly flat while
//         its dominant isoform swaps, and no gene-level table can show that.
//
// An "isoform switch" is the second without the first: DTU significant, gene DE
// not. That intersection is the whole reason for this layer, so it is computed
// here rather than left to the reader to spot across two tables.

import type { Bundle, DEGRow, DTURow, TranscriptRow } from '../types'

export interface IsoformGene {
  gene_id: string
  gene_name: string
  /** Smallest transcript-level usage padj in this gene. */
  dtuPadj: number | null
  /** The gene's own DESeq2 padj, or null when the gene layer never tested it. */
  genePadj: number | null
  geneLog2FC: number | null
  /** Transcripts whose usage moved, biggest absolute shift first. */
  moved: { tx: TranscriptRow; row: DTURow }[]
  nTranscripts: number
}

const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)

/**
 * Every gene the usage test could speak about, ranked.
 *
 * `switchOnly` is the flagship view: usage changed and the gene's total did
 * not. "Did not" is stated as `genePadj >= alpha` — NOT as "absent from the DEG
 * table", because a gene missing from that table was filtered out before any
 * test ran, and calling that "unchanged" would put untested genes on a list of
 * findings.
 */
export function isoformGenes(
  bundle: Bundle, contrastId: string,
  { alpha = 0.05, switchOnly = false }: { alpha?: number; switchOnly?: boolean } = {},
): IsoformGene[] {
  const dtu = bundle.dtuByContrast?.[contrastId]
  const transcripts = bundle.transcripts
  if (!dtu || !transcripts) return []

  const txById = new Map(transcripts.map(t => [t.transcript_id, t]))
  const degByGene = new Map<string, DEGRow>()
  for (const d of bundle.degByContrast[contrastId] ?? []) degByGene.set(d.gene_id, d)

  const nTx = new Map<string, number>()
  for (const t of transcripts) nTx.set(t.gene_id, (nTx.get(t.gene_id) ?? 0) + 1)

  const byGene = new Map<string, IsoformGene>()
  for (const row of dtu) {
    const tx = txById.get(row.transcript_id)
    if (!tx) continue
    const gid = row.gene_id || tx.gene_id
    let g = byGene.get(gid)
    if (!g) {
      const deg = degByGene.get(gid)
      g = {
        gene_id: gid,
        gene_name: tx.gene_name || deg?.gene_name || gid,
        dtuPadj: null,
        genePadj: deg && has(deg.padj) ? deg.padj : null,
        geneLog2FC: deg && has(deg.log2FoldChange) ? deg.log2FoldChange : null,
        moved: [],
        nTranscripts: nTx.get(gid) ?? 0,
      }
      byGene.set(gid, g)
    }
    // The gene's q-value is written by the engine per row and is the same for
    // every transcript of a gene; the smallest transcript padj is a different
    // number and is what ranks the isoforms inside it.
    if (has(row.gene_padj)) g.dtuPadj = g.dtuPadj == null ? row.gene_padj : Math.min(g.dtuPadj, row.gene_padj)
    else if (has(row.padj)) g.dtuPadj = g.dtuPadj == null ? row.padj : Math.min(g.dtuPadj, row.padj)
    if (has(row.padj) && row.padj < alpha) g.moved.push({ tx, row })
  }

  let out = [...byGene.values()].filter(g => g.moved.length > 0)
  if (switchOnly) out = out.filter(g => g.genePadj != null && g.genePadj >= alpha)
  for (const g of out) {
    g.moved.sort((a, b) => Math.abs(b.row.usage_effect ?? 0) - Math.abs(a.row.usage_effect ?? 0))
  }
  return out.sort((a, b) => (a.dtuPadj ?? 1) - (b.dtuPadj ?? 1))
}

/** Every transcript of one gene, with its usage row when the test reached it. */
export function isoformsOfGene(
  bundle: Bundle, contrastId: string, gene_id: string,
): { tx: TranscriptRow; row?: DTURow; dte?: DEGRow }[] {
  const dtu = new Map((bundle.dtuByContrast?.[contrastId] ?? []).map(r => [r.transcript_id, r]))
  const dte = new Map((bundle.dteByContrast?.[contrastId] ?? []).map(r => [r.gene_id, r]))
  return (bundle.transcripts ?? [])
    .filter(t => t.gene_id === gene_id)
    .map(t => ({ tx: t, row: dtu.get(t.transcript_id), dte: dte.get(t.transcript_id) }))
    .sort((a, b) => (b.row?.mean_usage_den ?? 0) - (a.row?.mean_usage_den ?? 0))
}

/** SQANTI category tally, biggest first. Empty when the bundle carries no categories. */
export function categoryTally(transcripts: readonly TranscriptRow[]): { name: string; n: number }[] {
  const t = new Map<string, number>()
  for (const x of transcripts) {
    if (!x.structural_category) continue
    t.set(x.structural_category, (t.get(x.structural_category) ?? 0) + 1)
  }
  return [...t].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
}

/** Tidy `novel_not_in_catalog` into `novel not in catalog` for an axis. */
export const prettyCategory = (s: string) => s.replace(/[_-]+/g, ' ')
