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

const WEBR_URL = 'https://webr.r-wasm.org/v0.6.0/webr.mjs'
// Our own WASM repo (hosts the locfit stub DESeq2 imports), served with the app.
// Resolved lazily: this module's pure helpers are unit-tested outside a browser,
// where `document` does not exist.
const locfitRepo = () => new URL('wasm/', document.baseURI).href.replace(/\/$/, '')

let webRPromise: Promise<any> | null = null
let installed = false

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
 * DESeq2, and only what the R below actually calls.
 *
 * apeglm went with it on every first run and was loaded by nothing — no
 * `lfcShrink` anywhere in this file — so every reader paid a download for a
 * package that never ran.
 */
async function ensureDESeq2(webR: any, log: (m: string) => void) {
  if (installed) return
  log('Installing DESeq2… (first run downloads ~tens of MB, then cached)')
  await webR.installPackages(['DESeq2'], {
    repos: [locfitRepo(), 'https://bioc.r-universe.dev', 'https://repo.r-wasm.org'],
  })
  installed = true
}

/**
 * ONE FIT, THEN PER-CONTRAST EXTRACTION — the same architecture as rnaseq-lab.
 *
 * `~ 0 + cond` is a cell-means model over EVERY sample the reader has left in:
 * one coefficient per group, so any comparison — one group against another, or
 * pooled sides — is a linear combination of those group means, extracted from
 * the single fit by `results(dds, contrast = ...)`.
 *
 * This used to refit for every comparison, on only the two sides' samples. Two
 * things were wrong with that. The whole cost is the fit — measured in webR on
 * 20 000 genes x 16 samples: read.csv 0.1 s, building the dds 0.4 s, DESeq()
 * 32.6 s, results() 0.3 s — so picking a second pair paid all of it again. And
 * each pair got its own dispersion, so the same comparison could return a
 * different p-value depending on which pair was asked for beside it, and none
 * of them matched what rnaseq-lab had put in the bundle. Fit once, cache it,
 * extract.
 *
 * The fit is cached in the R session under a key covering the matrix and which
 * samples are in it — the two things that change it. Group choice does not.
 *
 * THE GENE FILTER moves padj, which is worth saying plainly rather than
 * burying: fewer genes enter the Benjamini-Hochberg correction, so adjusted
 * p-values fall slightly. It is the standard edgeR/limma rule and the same one
 * rnaseq-lab applies, so the two apps agree about which genes were tested.
 *
 * Default parametric dispersion fitting never calls locfit; the rare fallback
 * path does, and locfit is a stub in this build, so retry with the "mean" fit.
 */
const FIT_R = `local({
  suppressMessages(library(DESeq2))
  KEY <- __KEY__
  if (!exists(".studio_key", envir = globalenv()) ||
      !identical(get(".studio_key", envir = globalenv()), KEY)) {
    counts <- round(as.matrix(read.csv("/work/counts.csv", row.names = 1, check.names = FALSE)))
    storage.mode(counts) <- "integer"
    cd <- read.csv("/work/coldata.csv", stringsAsFactors = FALSE, check.names = FALSE)
    rownames(cd) <- cd$sample
    counts <- counts[, cd$sample, drop = FALSE]
    # Same rule rnaseq-lab applies, so the two apps agree about which genes
    # were tested.
    keep <- rowSums(counts >= 10) >= max(2, min(table(cd$cond)))
    counts <- counts[keep, , drop = FALSE]
    cd$cond <- factor(cd$cond, levels = unique(cd$cond))
    dds <- DESeqDataSetFromMatrix(counts, cd, ~ 0 + cond)
    dds <- tryCatch(DESeq(dds, quiet = TRUE),
                    error = function(e) suppressWarnings(DESeq(dds, fitType = "mean", quiet = TRUE)))
    assign(".studio_dds", dds, envir = globalenv())
    assign(".studio_key", KEY, envir = globalenv())
    sprintf("fitted|%d|%d|%d", ncol(dds), nlevels(cd$cond), nrow(dds))
  } else {
    dds <- get(".studio_dds", envir = globalenv())
    sprintf("cached|%d|%d|%d", ncol(dds),
            nlevels(colData(dds)$cond), nrow(dds))
  }
})`

/**
 * Extract one comparison from the cached fit.
 *
 * A side naming several groups is the average of their group means, weighted by
 * how many samples each contributes — the cell-means way to write "these groups
 * pooled". For the ordinary one-group-per-side case the weights are 1 and -1 and
 * this is exactly the pairwise contrast.
 */
const EXTRACT_R = `local({
  suppressMessages(library(DESeq2))
  dds <- get(".studio_dds", envir = globalenv())
  w <- read.csv("/work/contrast.csv", stringsAsFactors = FALSE, check.names = FALSE)
  rn <- resultsNames(dds)
  cv <- setNames(rep(0, length(rn)), rn)
  nm <- paste0("cond", w$level)
  if (!all(nm %in% rn)) stop("a contrast names a group that is not in the fit")
  for (i in seq_len(nrow(w))) cv[nm[i]] <- cv[nm[i]] + w$weight[i]
  res <- as.data.frame(results(dds, contrast = cv))
  write.csv(data.frame(gene_id = rownames(res), gene_name = rownames(res),
            baseMean = round(res$baseMean, 3), log2FoldChange = round(res$log2FoldChange, 5),
            lfcSE = round(res$lfcSE, 5), pvalue = res$pvalue, padj = res$padj),
            "/work/deg.csv", row.names = FALSE)
  sprintf("%d", sum(res$padj < 0.05, na.rm = TRUE))
})`

/**
 * The contrast vector for one comparison, over GROUP MEANS.
 *
 * A side naming several groups is the average of their group means, weighted by
 * how many samples each contributes — the cell-means way to write "these groups
 * pooled". One group a side gives +1 / -1, the plain pairwise contrast.
 *
 * Weights on each side sum to +1 and -1, so the whole vector sums to zero: the
 * contrast is a difference of means and carries no intercept. Weighting by
 * sample count rather than 1/k keeps a pooled side reading as the average of
 * its SAMPLES, which is what refitting the two sides as one level used to give.
 */
export function contrastWeights(
  numerator: readonly string[],
  denominator: readonly string[],
  sizeOf: ReadonlyMap<string, number>,
): { level: string; weight: number }[] {
  const n = (gs: readonly string[]) => gs.reduce((a, g) => a + (sizeOf.get(g) ?? 0), 0)
  const nNum = n(numerator), nDen = n(denominator)
  if (!nNum || !nDen) throw new Error('a side of the contrast has no samples')
  return [
    ...numerator.map(g => ({ level: g, weight: (sizeOf.get(g) ?? 0) / nNum })),
    ...denominator.map(g => ({ level: g, weight: -(sizeOf.get(g) ?? 0) / nDen })),
  ]
}

export interface DeseqRequest {
  raw: CountsMatrix
  samples: SampleRow[]
  /** Groups on top of the ratio. More than one is pooled into a single level. */
  numerator: string[]
  /** Reference groups. More than one is pooled. */
  denominator: string[]
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
  { raw, samples, numerator, denominator, excluded = [], geneNames }: DeseqRequest,
  log: (m: string) => void,
): Promise<DEGRow[]> {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  const out = new Set(excluded)

  // EVERY sample the reader has left in goes to R, with its own group. The fit
  // spans all of them; the comparison is a contrast pulled out of it afterwards.
  const cols = raw.samples
    .map((s, j) => ({ s, j, c: cond[s] ?? '' }))
    .filter(x => !out.has(x.s) && x.c)

  const sizeOf = new Map<string, number>()
  for (const c of cols) sizeOf.set(c.c, (sizeOf.get(c.c) ?? 0) + 1)
  const nNum = numerator.reduce((a, g) => a + (sizeOf.get(g) ?? 0), 0)
  const nDen = denominator.reduce((a, g) => a + (sizeOf.get(g) ?? 0), 0)
  const nameNum = numerator.join(' + ') || '(nothing)'
  const nameDen = denominator.join(' + ') || '(nothing)'
  if (nNum < 2 || nDen < 2)
    throw new Error(`DESeq2 needs at least 2 replicates per side (${nameNum}: ${nNum}, ${nameDen}: ${nDen}).`)

  const webR = await getWebR(log)
  await ensureDESeq2(webR, log)

  // Group labels are recoded to g1..gN before they reach R: real labels carry
  // "+", "-" and spaces, which make.names() mangles into something that no
  // longer matches the contrast we asked for.
  const levels = [...new Set(cols.map(c => c.c))]
  const gid = (g: string) => `g${levels.indexOf(g) + 1}`

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
  const coldata = 'sample,cond\n' +
    cols.map(c => `${JSON.stringify(c.s)},${JSON.stringify(gid(c.c))}`).join('\n') + '\n'

  const wRows = contrastWeights(numerator, denominator, sizeOf)
    .map(w => `${JSON.stringify(gid(w.level))},${w.weight}`)

  try { await webR.FS.mkdir('/work') } catch { /* exists */ }
  const enc = new TextEncoder()
  const key = JSON.stringify([raw.geneIds.length, cols.map(c => c.s), cols.map(c => c.c)])
  await webR.FS.writeFile('/work/counts.csv', enc.encode(lines.join('\n') + '\n'))
  await webR.FS.writeFile('/work/coldata.csv', enc.encode(coldata))
  await webR.FS.writeFile('/work/contrast.csv', enc.encode('level,weight\n' + wRows.join('\n') + '\n'))

  const fit: string = await webR.evalRString(FIT_R.replace('__KEY__', JSON.stringify(key)))
  const [state, nS, nG, nGenes] = fit.split('|')
  log(state === 'cached'
    ? `Reusing the fit — ${nS} samples, ${nG} groups, ${nGenes} genes.`
    : `One fit over ${nS} samples in ${nG} groups, ${nGenes} genes.`)

  log(`Extracting ${nameNum} (n=${nNum}) vs ${nameDen} (n=${nDen})…`)
  const nDeg = await webR.evalRString(EXTRACT_R)
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
 * `.join` directly, never `[...xs].join`. Spreading accepts a bare string and
 * turns it into its characters, so a caller that had not been updated from the
 * old single-group signature produced `~deseq2:5+1+7+E+2_vs_...` — a valid
 * string, a plausible-looking id, and a key nothing else would ever match.
 * `.join` on a string throws, which is what a caller passing the wrong type
 * deserves.
 */
export const computedContrastId = (numerator: readonly string[], denominator: readonly string[]) =>
  `~deseq2:${numerator.join('+')}_vs_${denominator.join('+')}`

export const isComputedContrast = (id: string) => id.startsWith('~deseq2:')

export const countSignificant = (rows: DEGRow[], padjMax = 0.05, lfcMin = 1) =>
  rows.reduce((a, r) =>
    a + (r.padj != null && r.padj < padjMax && Math.abs(r.log2FoldChange) >= lfcMin ? 1 : 0), 0)
