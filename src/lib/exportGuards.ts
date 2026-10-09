/**
 * Shared export-safety helpers (pure, no Firebase, no React).
 *
 * Both are security controls used by the report exporters, which now live in
 * two files (ReportsAnalytics list export + BatchRecordSheet per-batch export).
 * Single definition so a fix can never land in only one exporter.
 */

/**
 * Escape a value for interpolation into an HTML string (the print windows
 * build HTML from DB-sourced batch fields). Escapes `& < > " '`, which is
 * sufficient because values are only ever placed in text/table cells, never
 * in an attribute or a `<script>` context.
 */
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );

/**
 * Neutralize spreadsheet formula injection: DB strings starting with = + - @
 * are treated as formulas by Excel and by downstream importers (Sheets,
 * LibreOffice, BI/ETL tools). Applies to every cell of every exported sheet.
 */
export const guardFormula = (cell: unknown) =>
  typeof cell === "string" && /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
