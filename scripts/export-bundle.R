#!/usr/bin/env Rscript
# ─────────────────────────────────────────────────────────────────────────────
# Convert a finished bulk RNA-seq analysis (~/RNAseq_Analyses/<project>) into an
# RNA-seq Studio result-bundle that the explorer can open.
#
#   Rscript export-bundle.R <analysis_dir> [out_dir]
#
# Emits, per cell type, a folder with: meta.json, samples.csv,
# normalized_counts.csv, raw_counts.csv, deg_<contrast>.csv, enrichment_<contrast>.csv
# (matching the schema in src/types.ts). Requires DESeq2 (to read the dds).
# ─────────────────────────────────────────────────────────────────────────────
suppressMessages(library(DESeq2))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("usage: Rscript export-bundle.R <analysis_dir> [out_dir]")
analysisDir <- normalizePath(args[1], mustWork = TRUE)
outRoot     <- if (length(args) >= 2) args[2] else file.path(analysisDir, "studio_bundle")

readc <- function(f) read.csv(f, stringsAsFactors = FALSE, check.names = FALSE)

# Minimal JSON writer (uses jsonlite if available, else a small fallback).
to_json <- function(x) {
  if (requireNamespace("jsonlite", quietly = TRUE))
    return(jsonlite::toJSON(x, auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null"))
  esc <- function(s) gsub('"', '\\\\"', gsub('\\\\', '\\\\\\\\', s))
  enc <- function(v) {
    if (is.null(v) || (length(v) == 1 && is.na(v))) return("null")
    if (is.list(v)) {
      if (!is.null(names(v)) && length(names(v)) && all(nzchar(names(v))))
        return(paste0("{", paste0('"', names(v), '":', vapply(v, enc, ""), collapse = ","), "}"))
      return(paste0("[", paste0(vapply(v, enc, ""), collapse = ","), "]"))
    }
    if (length(v) > 1) return(paste0("[", paste0(vapply(v, enc, ""), collapse = ","), "]"))
    if (is.logical(v)) return(tolower(as.character(v)))
    if (is.numeric(v)) return(as.character(v))
    paste0('"', esc(as.character(v)), '"')
  }
  enc(x)
}

# ── project-level metadata (best-effort from design.yaml) ────────────────────
project <- basename(analysisDir); species <- "unknown"
df <- file.path(analysisDir, "design.yaml")
if (file.exists(df)) {
  txt <- readLines(df, warn = FALSE)
  g <- function(key) { h <- grep(paste0("^", key, ":"), txt, value = TRUE); if (length(h)) trimws(sub(paste0("^", key, ":"), "", h[1])) else NA }
  if (!is.na(g("project_name"))) project <- g("project_name")
  if (!is.na(g("species")))      species <- g("species")
}

# ── enrichment file → unified rows ───────────────────────────────────────────
srcLabel <- function(s) switch(s, GO_BP = "GO:BP", GO_MF = "GO:MF", GO_CC = "GO:CC",
                               KEGG = "KEGG", Reactome = "Reactome", WikiPathways = "WikiPathways", s)
oraRows <- function(f, source, direction) {
  d <- readc(f); if (!nrow(d)) return(NULL)
  bg <- suppressWarnings(as.integer(sub("/.*", "", d$BgRatio)))
  data.frame(source = source, method = "ORA", id = d$ID, description = d$Description,
             direction = direction, setSize = bg, count = d$Count,
             score = if ("FoldEnrichment" %in% names(d)) d$FoldEnrichment else NA,
             pvalue = d$pvalue, padj = d$p.adjust, geneID = d$geneID,
             stringsAsFactors = FALSE)
}
gseaRows <- function(f, source) {
  d <- readc(f); if (!nrow(d)) return(NULL)
  core <- if ("core_enrichment" %in% names(d)) d$core_enrichment else ""
  cnt  <- vapply(strsplit(core, "/"), function(x) length(x[x != ""]), integer(1))
  data.frame(source = source, method = "GSEA", id = d$ID, description = d$Description,
             direction = ifelse(d$NES > 0, "up", "down"), setSize = d$setSize, count = cnt,
             score = d$NES, pvalue = d$pvalue, padj = d$p.adjust, geneID = core,
             stringsAsFactors = FALSE)
}

dir.create(outRoot, showWarnings = FALSE, recursive = TRUE)
resDir <- file.path(analysisDir, "results")
cts <- list.dirs(resDir, recursive = FALSE, full.names = FALSE)
if (!length(cts)) stop("no results/<cell_type> folders found in ", analysisDir)

for (ct in cts) {
  ctDir <- file.path(resDir, ct)
  ddsFile <- list.files(ctDir, pattern = "dds.*\\.RData$", full.names = TRUE, recursive = TRUE)[1]
  if (is.na(ddsFile)) { message("  [skip] no dds .RData under ", ctDir); next }

  e <- new.env(); load(ddsFile, envir = e)
  dds <- NULL
  for (o in ls(e)) { x <- get(o, envir = e); if (is(x, "DESeqDataSet")) { dds <- x; break } }
  if (is.null(dds)) { message("  [skip] no DESeqDataSet in ", ddsFile); next }

  nc <- tryCatch(counts(dds, normalized = TRUE),
                 error = function(err) counts(estimateSizeFactors(dds), normalized = TRUE))
  cd <- as.data.frame(colData(dds))
  control <- if (is.factor(colData(dds)$condition)) levels(colData(dds)$condition)[1] else as.character(cd$condition[1])

  outDir <- if (length(cts) > 1) file.path(outRoot, ct) else outRoot
  dir.create(outDir, showWarnings = FALSE, recursive = TRUE)

  # samples.csv (condition + any covariate columns from colData)
  samp <- data.frame(sample = rownames(cd), condition = as.character(cd$condition), stringsAsFactors = FALSE)
  for (cc in setdiff(colnames(cd), c("condition", "sizeFactor", "replaceable")))
    samp[[cc]] <- as.character(cd[[cc]])
  write.csv(samp, file.path(outDir, "samples.csv"), row.names = FALSE)

  # per-contrast DEG + enrichment
  deaDir <- file.path(ctDir, "DEA"); enrDir <- file.path(ctDir, "enrichment")
  degFiles <- list.files(deaDir, pattern = "_DEG_full\\.csv$", full.names = TRUE)
  gene_name_map <- c()
  contrastsMeta <- list()

  for (f in degFiles) {
    contrast <- sub("_DEG_full\\.csv$", "", sub(paste0("^", ct, "_"), "", basename(f)))
    d <- readc(f)
    deg <- data.frame(gene_id = d$gene_id, gene_name = if ("gene_name" %in% names(d)) d$gene_name else d$gene_id,
                      baseMean = d$baseMean, log2FoldChange = d$log2FoldChange,
                      lfcSE = if ("lfcSE" %in% names(d)) d$lfcSE else NA,
                      pvalue = d$pvalue, padj = d$padj, stringsAsFactors = FALSE)
    write.csv(deg, file.path(outDir, paste0("deg_", contrast, ".csv")), row.names = FALSE)
    m <- deg$gene_name; names(m) <- deg$gene_id; gene_name_map <- c(gene_name_map, m[!names(m) %in% names(gene_name_map)])
    nDeg <- sum(deg$padj < 0.05 & abs(deg$log2FoldChange) >= 1, na.rm = TRUE)

    # enrichment for this contrast
    enrRowsList <- list()
    if (dir.exists(enrDir)) {
      efiles <- list.files(enrDir, pattern = "\\.csv$", full.names = TRUE)
      prefix <- paste0(ct, "_", contrast, "_")
      for (ef in efiles) {
        b <- basename(ef); if (!startsWith(b, prefix)) next
        rem <- sub("\\.csv$", "", sub(prefix, "", b, fixed = TRUE))
        if (startsWith(rem, "GSEA_")) {
          enrRowsList[[b]] <- gseaRows(ef, paste0("GSEA:", sub("^GSEA_", "", rem)))
        } else if (startsWith(rem, "Up_") || startsWith(rem, "Down_")) {
          dir_ <- ifelse(startsWith(rem, "Up_"), "up", "down")
          src <- sub("^(Up|Down)_", "", rem)
          enrRowsList[[b]] <- oraRows(ef, srcLabel(src), dir_)
        }
      }
    }
    enrichFile <- NA
    enr <- do.call(rbind, enrRowsList)
    if (!is.null(enr) && nrow(enr)) {
      enrichFile <- paste0("enrichment_", contrast, ".csv")
      write.csv(enr, file.path(outDir, enrichFile), row.names = FALSE)
    }

    parts <- strsplit(contrast, "_vs_")[[1]]
    contrastsMeta[[length(contrastsMeta) + 1]] <- list(
      id = contrast, numerator = parts[1], denominator = if (length(parts) > 1) parts[2] else control,
      label = gsub("_vs_", " vs ", contrast),
      deg_file = paste0("deg_", contrast, ".csv"),
      enrichment_file = enrichFile, n_deg = nDeg, padj_threshold = 0.05, lfc_threshold = 1)
  }

  # normalized_counts.csv (gene_id, gene_name, samples…)
  gn <- gene_name_map[rownames(nc)]; gn[is.na(gn)] <- rownames(nc)[is.na(gn)]
  counts_df <- data.frame(gene_id = rownames(nc), gene_name = unname(gn), check.names = FALSE)
  counts_df <- cbind(counts_df, round(as.data.frame(nc), 3))
  write.csv(counts_df, file.path(outDir, "normalized_counts.csv"), row.names = FALSE)

  # raw_counts.csv — un-normalized counts. Optional for viewing, but required for
  # Studio to run DESeq2 on a pair this export did not include: DESeq2 models raw
  # counts and derives its own size factors.
  raw <- tryCatch(BiocGenerics::counts(dds, normalized = FALSE), error = function(e) NULL)
  if (!is.null(raw)) {
    gr <- gene_name_map[rownames(raw)]; gr[is.na(gr)] <- rownames(raw)[is.na(gr)]
    raw_df <- data.frame(gene_id = rownames(raw), gene_name = unname(gr), check.names = FALSE)
    raw_df <- cbind(raw_df, as.data.frame(raw))
    write.csv(raw_df, file.path(outDir, "raw_counts.csv"), row.names = FALSE)
    message("  [bundle] raw_counts.csv written (enables new contrasts in Studio)")
  } else {
    message("  [bundle] raw counts unavailable - Studio will not be able to add contrasts")
  }

  # genesets.csv — full memberships for live ORA (msigdbr, force-installed),
  # restricted to genes present in this dataset. Robust to msigdbr API renames.
  if (!requireNamespace("msigdbr", quietly = TRUE)) {
    message("  [genesets] msigdbr not found — installing from CRAN ...")
    try(install.packages("msigdbr", repos = "https://cloud.r-project.org"), silent = TRUE)
  }
  if (!requireNamespace("msigdbr", quietly = TRUE))
    stop("msigdbr is required for gene sets but could not be installed; install it and re-run.")

  bgSym <- unique(toupper(unname(gn)))
  d <- as.data.frame(msigdbr::msigdbr(species = "Homo sapiens"))
  col <- function(cands) { for (c in cands) if (c %in% names(d)) return(c); NA_character_ }
  nameCol <- col(c("gs_name")); symCol <- col(c("gene_symbol"))
  collCol <- col(c("gs_collection", "gs_cat")); subCol <- col(c("gs_subcollection", "gs_subcat"))
  coll <- d[[collCol]]; sub <- d[[subCol]]
  src <- ifelse(coll == "H", "Hallmark",
         ifelse(grepl("^CP:KEGG", sub), "KEGG",
         ifelse(sub == "CP:REACTOME", "Reactome",
         ifelse(sub == "CP:WIKIPATHWAYS", "WikiPathways",
         ifelse(sub == "GO:BP", "GO:BP", NA_character_)))))
  keep <- !is.na(src) & toupper(d[[symCol]]) %in% bgSym
  gs <- data.frame(source = src[keep], set_id = d[[nameCol]][keep],
                   set_name = d[[nameCol]][keep], gene = d[[symCol]][keep], stringsAsFactors = FALSE)
  # compact: one row per set, genes "/"-joined (keeps the file small)
  byset <- split(gs$gene, gs$set_id)
  meta1 <- gs[!duplicated(gs$set_id), ]
  ord <- match(names(byset), meta1$set_id)
  compact <- data.frame(source = meta1$source[ord], set_id = names(byset),
                        set_name = meta1$set_name[ord],
                        genes = vapply(byset, function(x) paste(unique(x), collapse = "/"), ""),
                        stringsAsFactors = FALSE)
  write.csv(compact, file.path(outDir, "genesets.csv"), row.names = FALSE)

  # ── gene-set library info ──
  message("  [genesets] msigdbr ", as.character(utils::packageVersion("msigdbr")),
          "  (restricted to ", length(bgSym), " dataset genes)")
  for (s in sort(unique(gs$source))) {
    ss <- gs[gs$source == s, ]
    message(sprintf("    %-13s %5d sets  %6d genes", s, length(unique(ss$set_id)), length(unique(ss$gene))))
  }
  message(sprintf("    %-13s %5d sets  %6d genes", "TOTAL", length(unique(gs$set_id)), length(unique(gs$gene))))

  # meta.json
  meta <- list(schema = 1, project = project, species = species,
               created = format(Sys.Date()), engine = "desktop-R", control = control,
               conditions = unique(c(control, as.character(unique(cd$condition)))),
               gene_id_type = if (any(grepl("^ENS", rownames(nc)))) "ensembl" else "symbol",
               counts_unit = "DESeq2 normalized (median-of-ratios)",
               n_genes = nrow(nc), n_samples = ncol(nc), contrasts = contrastsMeta)
  writeLines(as.character(to_json(meta)), file.path(outDir, "meta.json"))
  message("  [ok] ", ct, " → ", outDir, "  (", length(contrastsMeta), " contrast(s), ", nrow(nc), " genes)")
}

message("Done. Open the bundle folder in RNA-seq Studio via ‘Open analysis folder’.")
