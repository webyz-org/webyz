/**
 * RFC 4180 CSV. A cell is quoted when it contains a comma, a quote, a CR or
 * an LF; a quote inside a quoted cell is doubled. Rows end in CRLF, which is
 * what spreadsheets on every platform read without a prompt.
 *
 * Cells that start with =, +, - or @ are prefixed with a single quote so a
 * spreadsheet does not evaluate them as formulas: page paths, referrers and
 * UTM values are visitor-controlled text and this file is opened in Excel.
 */
const FORMULA_LEADS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export const csvCell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  let text = value;
  if (text.length > 0 && FORMULA_LEADS.has(text[0])) text = `'${text}`;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string => {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
};

/**
 * A filename segment safe for Content-Disposition: ASCII word chars, dots and
 * hyphens only, with no leading or trailing dots or hyphens so nothing can
 * start with "..".
 */
export const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "export";
