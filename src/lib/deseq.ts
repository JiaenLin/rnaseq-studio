// DESeq2 in the browser, via webR — for comparisons the pipeline did not export.
//
// A 23-arm design has hundreds of possible pairs and no pipeline exports them
// all. Rather than approximate the missing ones with a lighter test, we run the
// real thing: R 4.6.0 compiled to WebAssembly, with the same DESeq2 the upstream
// analysis used. Results are therefore directly comparable with the contrasts
// already in the bundle.
//
// DESeq2 models raw counts and derives its own size factors, so this needs
// `raw_counts.csv`. Feeding it the normalized matrix would silently violate the
// negative-binomial assumptions, so a bundle without raw counts simply cannot
// compute new pairs — the UI says so rather than substituting something weaker.

import type { CountsMatrix, DEGRow, SampleRow } from '../types'

/**
 * Which test a run performed HERE uses.
 *
 * Both are real differential expression and both are cited as themselves; the
 * difference is what they cost. Measured on 20 000 genes x 16 samples in webR,
 * the same data and the same filter:
 *
 *   limma-voom   1.9 s
 *   DESeq2      18.6 s
 *
 * Which is the whole of why rnaseq-lab "feels fine" and this did not: the lab
 * offers both and defaults to limma-voom, and this offered only DESeq2. A test
 * that takes half a minute is one people stop asking for, and the comparison
 * they then read is whichever pair the pipeline happened to export — which is
 * the constraint this app was built to remove.
 */
export type Engine = 'limma' | 'deseq2'

export const ENGINES: { id: Engine; label: string; blurb: string; cites: string }[] = [
  { id: 'limma', label: 'limma-voom', blurb: 'A few seconds. Precision-weighted linear models on log-CPM — the standard fast test, and what RNA-seq Lab runs by default.', cites: 'limma-voom' },
  { id: 'deseq2', label: 'DESeq2', blurb: 'Half a minute or so. Negative-binomial GLM with shrunken dispersions — what most published bulk analyses report.', cites: 'DESeq2' },
]

export const engineLabel = (e: Engine) => (e === 'limma' ? 'limma-voom' : 'DESeq2')

const WEBR_URL = 'https://webr.r-wasm.org/v0.6.0/webr.mjs'
// Our own WASM repo (hosts the locfit stub DESeq2 imports), served with the app.
// Resolved lazily: this module's pure helpers are unit-tested outside a browser,
// where `document` does not exist.
const locfitRepo = () => new URL('wasm/', document.baseURI).href.replace(/\/$/, '')

let webRPromise: Promise<any> | null = null

async function getWebR(log: (m: string) => void): Promise<any> {
  if (!webRPromise) {
    webRPromise = (async () => {
      log('Loading R 4.6.0 (WebAssembly)…')
      const mod: any = await import(/* @vite-ignore */ WEBR_URL)
      const webR = new mod.WebR()
      await webR.init()
      log('R ready.')
      return webR
    })()
  }
  return webRPromise
}

/**
 * Only what the R below actually calls.
 *
 * apeglm was installed on every first run and never used — nothing here calls
 * lfcShrink — so every reader paid a download for a package that was loaded by
 * nothing. limma-voom needs limma and edgeR, which are a fraction of DESeq2's
 * dependency tree, so choosing the fast engine is also the small download.
 */
const PACKAGES: Record<Engine, string[]> = {
  limma: ['limma', 'edgeR'],
  deseq2: ['DESeq2'],
}
const installed = new Set<Engine>()

async function ensurePackages(webR: any, engine: Engine, log: (m: string) => void) {
  if (installed.has(engine)) return
  log(`Installing ${PACKAGES[engine].join(' + ')}… (first run downloads, then cached)`)
  await webR.installPackages(PACKAGES[engine], {
    repos: [locfitRepo(), 'https://bioc.r-universe.dev', 'https://repo.r-wasm.org'],
  })
  installed.add(engine)
}

/**
 * The gene filter, shared by both engines and taken from rnaseq-lab.
 *
 * `rowSums(counts >= 10) >= max(2, smallest group)` is the standard
 * edgeR/limma rule and is exactly what the lab already applies on its
 * limma path, so the two apps now agree about which genes were tested.
 *
 * This ran on `rowSums(counts) > 0` — drop only the genes that are zero
 * everywhere — which is barely a filter: on a 20 000-gene matrix it removed
 * nothing and DESeq2 fitted a model for every unexpressed gene in the
 * annotation. Filtering first is DESeq2's own documented advice, and measured
 * here it is 20 000 genes down to 14 478 and 26.4 s down to 18.6 s.
 *
 * IT MOVES padj, and that is worth saying plainly rather than burying: fewer
 * genes enter the Benjamini-Hochberg correction, so adjusted p-values fall
 * slightly. The genes it removes are ones `results()` would have given padj =
 * NA to anyway under independent filtering — but "would have" is not "did", and
 * the Methods text says the filter was applied.
 */
const FILTER_R = `keep <- rowSums(counts >= 10) >= max(2, min(table(cd$condition)))
  counts <- counts[keep, , drop = FALSE]`

const READ_R = `counts <- round(as.matrix(read.csv("/work/counts.csv", row.names = 1, check.names = FALSE)))
  storage.mode(counts) <- "integer"
  cd <- read.csv("/work/coldata.csv", stringsAsFactors = FALSE, check.names = FALSE)
  rownames(cd) <- cd$sample
  counts <- counts[, cd$sample, drop = FALSE]
  cd$condition <- factor(cd$condition, levels = c(REF, setdiff(unique(cd$condition), REF)))
  ${FILTER_R}`

const WRITE_R = `write.csv(out, "/work/deg.csv", row.names = FALSE)
  sprintf("%d", sum(out$padj < 0.05, na.rm = TRUE))`

// Default parametric dispersion fitting never calls locfit; the rare fallback
// path does, and locfit is a stub in this build, so retry with the "mean" fit.
const DESEQ_R = `local({
  suppressMessages(library(DESeq2))
  REF <- __REF__
  ${READ_R}
  dds <- DESeqDataSetFromMatrix(counts, cd, ~condition)
  dds <- tryCatch(DESeq(dds, quiet = TRUE),
                  error = function(e) suppressWarnings(DESeq(dds, fitType = "mean", quiet = TRUE)))
  res <- as.data.frame(results(dds))
  out <- data.frame(gene_id = rownames(res), gene_name = rownames(res),
            baseMean = round(res$baseMean, 3), log2FoldChange = round(res$log2FoldChange, 5),
            lfcSE = round(res$lfcSE, 5), pvalue = res$pvalue, padj = res$padj)
  ${WRITE_R}
})`

/**
 * limma-voom, written to emit the same seven columns DESeq2 does.
 *
 * `baseMean` is the mean of the normalised counts rather than DESeq2's
 * size-factor-scaled mean, and `lfcSE` is the moderated standard error — both
 * are the same quantity in spirit and neither is the other's number. Every
 * column the bundle contract names is present and real; nothing is faked to
 * fill a slot, which is why AveExpr is not passed off as baseMean.
 */
const LIMMA_R = `local({
  suppressMessages({library(limma); library(edgeR)})
  REF <- __REF__
  ${READ_R}
  d <- calcNormFactors(DGEList(counts))
  design <- model.matrix(~condition, data = cd)
  v <- voom(d, design)
  fit <- eBayes(lmFit(v, design))
  tt <- topTable(fit, coef = 2, number = Inf, sort.by = "none")
  cpm <- edgeR::cpm(d, normalized.lib.sizes = TRUE)
  out <- data.frame(gene_id = rownames(tt), gene_name = rownames(tt),
            baseMean = round(rowMeans(cpm)[rownames(tt)], 3),
            log2FoldChange = round(tt$logFC, 5),
            lfcSE = round(sqrt(fit$s2.post[rownames(tt)]) * fit$stdev.unscaled[rownames(tt), 2], 5),
            pvalue = tt$P.Value, padj = tt$adj.P.Val)
  ${WRITE_R}
})`

const R_FOR: Record<Engine, string> = { limma: LIMMA_R, deseq2: DESEQ_R }

export interface DeseqRequest {
  raw: CountsMatrix
  samples: SampleRow[]
  /** Groups on top of the ratio. More than one is pooled into a single level. */
  numerator: string[]
  /** Reference groups. More than one is pooled. */
  denominator: string[]
  /** Which test to run. Defaults to the fast one — see Engine. */
  engine?: Engine
  /** Sample names the reader has taken out of the analysis. */
  excluded?: readonly string[]
  /**
   * gene_id -> symbol, so a run performed here carries the same gene names the
   * pipeline's own tables do.
   *
   * Without it every DEG table from an in-browser run reads
   * `ENSMUSG00000121069`, because the matrix R is handed is keyed by accession
   * and R has no idea what any of them are called. The symbols are already in
   * the bundle — `normalized_counts.csv` has a gene_name column — they were
   * simply never carried across. It has been that way since the in-browser run
   * was added; picking contrasts freely just made it the common case rather
   * than the rare one.
   */
  geneNames?: Map<string, string>
}

/**
 * Run DESeq2 for one comparison. Only the selected samples are sent to R.
 *
 * Each side may name several groups, and when it does they are POOLED into one
 * level rather than modelled separately. On a 2×2 that is how the main effect is
 * asked for — {KO_Cold, KO_Thermo} against {Ctrl_Cold, Ctrl_Thermo} is the
 * genotype effect across both temperatures, and no pairwise contrast between the
 * four cells answers it.
 *
 * Pooling is the right model here and is also a claim worth being honest about:
 * it treats the temperatures as replicates of a genotype, so it has more power
 * than either pairwise contrast and it will miss an effect that runs in opposite
 * directions in the two. That is what an interaction term is for, and this app
 * does not fit one — the bundle's own exporter does.
 */
export async function runDESeq2(
  { raw, samples, numerator, denominator, engine = 'limma', excluded = [], geneNames }: DeseqRequest,
  log: (m: string) => void,
): Promise<DEGRow[]> {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  // Not `num` — that is the module-level number parser below, and shadowing it
  // inside the one function that also calls parseDegCsv is a trap for later.
  const numSet = new Set(numerator)
  const denSet = new Set(denominator)
  const out = new Set(excluded)

  // The pooled level, not the group name: R sees two conditions whatever the
  // reader selected, so the model formula and the results() call never have to
  // know how many groups went into each side.
  const cols = raw.samples
    .map((s, j) => ({ s, j, c: cond[s] ?? '' }))
    .filter(x => !out.has(x.s))
    .map(x => ({ ...x, side: numSet.has(x.c) ? 'TEST' : denSet.has(x.c) ? 'CTRL' : '' }))
    .filter(x => x.side)

  const nNum = cols.filter(x => x.side === 'TEST').length
  const nDen = cols.filter(x => x.side === 'CTRL').length
  const nameNum = numerator.join(' + ') || '(nothing)'
  const nameDen = denominator.join(' + ') || '(nothing)'
  if (nNum < 2 || nDen < 2)
    throw new Error(`DESeq2 needs at least 2 replicates per side (${nameNum}: ${nNum}, ${nameDen}: ${nDen}).`)

  const webR = await getWebR(log)
  await ensurePackages(webR, engine, log)

  // Raw counts for just these samples, as CSV for R.
  const S = raw.samples.length
  const header = ['gene_id', ...cols.map(c => JSON.stringify(c.s))].join(',')
  const lines = new Array<string>(raw.geneIds.length + 1)
  lines[0] = header
  for (let i = 0; i < raw.geneIds.length; i++) {
    const base = i * S
    const cells = new Array<string>(cols.length + 1)
    cells[0] = JSON.stringify(raw.geneIds[i])
    for (let k = 0; k < cols.length; k++) cells[k + 1] = String(Math.round(raw.values[base + cols[k].j]))
    lines[i + 1] = cells.join(',')
  }
  const coldata = 'sample,condition\n' +
    cols.map(c => `${JSON.stringify(c.s)},${JSON.stringify(c.side)}`).join('\n') + '\n'

  try { await webR.FS.mkdir('/work') } catch { /* exists */ }
  const enc = new TextEncoder()
  await webR.FS.writeFile('/work/counts.csv', enc.encode(lines.join('\n') + '\n'))
  await webR.FS.writeFile('/work/coldata.csv', enc.encode(coldata))

  log(`Running ${engineLabel(engine)} — ${nameNum} (n=${nNum}) vs ${nameDen} (n=${nDen})…`)
  const nDeg = await webR.evalRString(R_FOR[engine].replace('__REF__', JSON.stringify('CTRL')))
  const csv = new TextDecoder().decode(await webR.FS.readFile('/work/deg.csv'))
  log(`Done — ${nDeg} genes at padj < 0.05.`)
  return withSymbols(parseDegCsv(csv), geneNames ?? namesOf(raw))
}

/** gene_id -> symbol from a matrix that carries both, for the fallback. */
export function namesOf(m: CountsMatrix): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < m.geneIds.length; i++) {
    const nm = m.geneNames[i]
    if (nm && nm !== m.geneIds[i]) out.set(m.geneIds[i], nm)
  }
  return out
}

/**
 * Put the symbols back.
 *
 * R only ever saw accessions, so every row comes back with gene_name equal to
 * gene_id. The lookup is the bundle's own, so a gene reads the same here as it
 * does in a table the pipeline exported — and a gene the lookup does not know
 * keeps its accession rather than becoming blank.
 */
export function withSymbols(rows: DEGRow[], names: Map<string, string>): DEGRow[] {
  if (!names.size) return rows
  for (const r of rows) r.gene_name = names.get(r.gene_id) || r.gene_id
  return rows
}

const num = (v: string): number | null => {
  const t = v.trim().replace(/^"|"$/g, '')
  if (!t || t === 'NA') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseDegCsv(text: string): DEGRow[] {
  const lines = text.trim().split(/\r?\n/)
  const out: DEGRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const id = c[0].replace(/^"|"$/g, '')
    out.push({
      gene_id: id,
      gene_name: c[1].replace(/^"|"$/g, '') || id,
      baseMean: num(c[2]) ?? 0,
      log2FoldChange: num(c[3]) as number,
      lfcSE: num(c[4]),
      pvalue: num(c[5]),
      padj: num(c[6]),
    })
  }
  return out
}

/**
 * The id a run performed here is filed under.
 *
 * `~run:`, not `~deseq2:`. It was the latter while DESeq2 was the only thing
 * this app could run, and became a lie the moment limma-voom was added — the id
 * is not private, it names the CSV the DEG table downloads, so a limma result
 * left here as `deg_~deseq2:KO_vs_WT.csv` on somebody's disk. The engine is
 * appended by the caller, so the filename says which test produced it.
 *
 * `.join` directly, never `[...xs].join`. Spreading accepts a bare string and
 * turns it into its characters, so a caller that had not been updated from the
 * old single-group signature produced `~run:5+1+7+E+2_vs_...` — a valid
 * string, a plausible-looking id, and a key nothing else would ever match.
 * `.join` on a string throws, which is what a caller passing the wrong type
 * deserves.
 */
export const computedContrastId = (numerator: readonly string[], denominator: readonly string[]) =>
  `~run:${numerator.join('+')}_vs_${denominator.join('+')}`

export const isComputedContrast = (id: string) => id.startsWith('~run:')

export const countSignificant = (rows: DEGRow[], padjMax = 0.05, lfcMin = 1) =>
  rows.reduce((a, r) =>
    a + (r.padj != null && r.padj < padjMax && Math.abs(r.log2FoldChange) >= lfcMin ? 1 : 0), 0)
