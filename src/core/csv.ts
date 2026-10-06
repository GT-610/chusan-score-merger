/**
 * RFC 4180 CSV reader.
 *
 * A naive `split(',')` is not merely suboptimal on these exports, it is
 * wrong: song titles legitimately contain commas and doubled quotes, e.g.
 *
 *     2031,"Little ""Sister"" Bitch",13+,3,643590,...
 *     2461,"《創造》 ～ Cries, beyond The End",13+,2,1004946,...
 *
 * Splitting on commas shifts every column after the title and silently
 * corrupts the row. This parser is a character scanner, matching what
 * Python's `csv.DictReader` does.
 */

/** Strip a UTF-8 BOM if the exporter wrote one. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** 1-based line numbers of rows whose field count differs from header. */
  malformed: number[];
}

/**
 * Parse CSV text into a header plus rows.
 *
 * Handles: quoted fields, `""` escapes, CR / LF / CRLF line endings,
 * a trailing newline, and quoted fields containing newlines.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = stripBom(input);
  const rows: string[][] = [];
  const malformed: number[] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }

    switch (c) {
      case '"':
        inQuotes = true;
        sawAny = true;
        break;
      case ',':
        endField();
        sawAny = true;
        break;
      case '\r':
        // Swallow; the following \n closes the row. A lone \r also closes.
        if (text[i + 1] !== '\n') {
          endRow();
          sawAny = false;
        }
        break;
      case '\n':
        endRow();
        line++;
        sawAny = false;
        break;
      default:
        sawAny = true;
        field += c;
    }
  }

  // Flush a final row that was not newline-terminated.
  if (sawAny || field.length > 0 || row.length > 0) {
    endRow();
  }

  if (rows.length === 0) {
    return { header: [], rows: [], malformed };
  }

  const header = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== header.length) malformed.push(i + 1);
  }

  return { header, rows: rows.slice(1), malformed };
}

/** Parse into objects keyed by header name. Later duplicate headers win. */
export function parseCsvRecords(input: string): {
  records: Record<string, string>[];
  malformed: number[];
} {
  const { header, rows, malformed } = parseCsv(input);
  const records = rows.map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = (r[i] ?? '').trim();
    }
    return obj;
  });
  return { records, malformed };
}