// Plain CSV export — replaces the `xlsx` package (unpatched high-severity
// Prototype Pollution + ReDoS: GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9, no
// fix available upstream). CSV opens natively in Excel/Numbers/Sheets and
// needs no parsing library on either side of this app.

// A cell starting with =, +, -, @, tab, or CR is how a CSV/Excel formula
// injection payload (e.g. `=cmd|'/c calc'!A1`, sourced from a user-entered
// field like reporter_name or a machine note) gets executed the moment
// someone opens the exported file in Excel. Prefixing with a single quote
// defuses it — Excel/Sheets render the quote-prefixed text literally — without
// changing what a human reading the cell sees.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

function escapeCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

// Renders one row per object, columns in `columns` order (or the first row's
// key order if omitted). CRLF line endings match the CSV RFC (4180) and are
// what Excel expects — LF-only rows can render as one giant first cell.
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return ''
  const cols = columns ?? Object.keys(rows[0])
  const lines = [cols.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(cols.map(c => escapeCell(row[c])).join(','))
  }
  return lines.join('\r\n')
}

// A single header-less row, e.g. a "label, value" summary line. Lets a
// multi-section export (summary block + data table) build both with the
// same escaping/injection rules without forcing the summary into toCsv's
// object-with-header shape.
export function csvRow(cells: unknown[]): string {
  return cells.map(escapeCell).join(',')
}

// UTF-8 BOM so Excel on Windows (this app's primary user base) auto-detects
// UTF-8 instead of misreading the Chinese/Indonesian text as the system codepage.
const BOM = '\uFEFF'

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
