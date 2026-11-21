// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for {text, header}, but reads the text with indexOf
// jumps and slice() instead of one character at a time.
//
// The reading policy is csv-reader's own, kept exactly:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended to it as it stands (quote_junk, when the field ends); a quote that
//     never closes is read as a literal character and the text after it is read
//     again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside a quoted field counted), row its record's
//     index in rows (null for the header), in the order met, a field's quote_junk
//     when the field ends and a record's short_row or long_row when the record ends.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    // Candidate record end: the first LF after the record starts. It is the true
    // record end unless a quoted field of this record spans it; the flag below
    // drops when such a field is read, and unquoted fields then go back to
    // finding their own line break. While it holds, an unquoted field ends at
    // the next comma or at this LF, so it needs one indexOf, not two.
    let recEnd = text.indexOf('\n', pos);
    let recEndValid = true;
    // Whether any field of this record can hold a stray CR. The segment up to
    // the candidate record end is scanned once here; a record with no CR in it
    // skips the per-field CR scan entirely. (A CR inside a quoted field only
    // makes this conservative.) When a quoted field spans the candidate end,
    // recEndValid drops and the per-field scan comes back on for later fields.
    let contentEnd = recEnd;
    if (recEnd !== -1 && recEnd > pos && text.charCodeAt(recEnd - 1) === 13) contentEnd = recEnd - 1;
    let recordHasCR = recEnd === -1
      ? text.slice(pos).indexOf('\r') !== -1
      : text.slice(pos, contentEnd).indexOf('\r') !== -1;
    const fields = [];
    let ended = COMMA;
    let quoted = false;

    while (ended === COMMA) {
      let value;
      if (pos < len && text.charCodeAt(pos) === 34) {
        quoted = true;
        // ---- a field that opens with a quote ----
        const open = pos;
        let p = pos + 1;
        let v = '';
        let closed = -1;
        while (true) {
          const q = text.indexOf('"', p);
          if (q === -1) break;
          if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
            v += text.slice(p, q) + '"';
            p = q + 2;
            continue;
          }
          v += text.slice(p, q);
          closed = q;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text after
          // it is read again as unquoted. (line is still the opening line: the
          // scan above counted nothing, which is the reset the reference does.)
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted(text, len, open + 1, '"', line);
          value = r.value;
          ended = r.ended;
          pos = r.pos;
          line = r.line;
          for (let i = 0; i < r.stray; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        } else {
          // The field closed. Each CRLF or lone CR inside it is one LF, and each
          // line break inside it counts one line.
          if (v.indexOf('\r') !== -1) v = v.replace(/\r\n?/g, '\n');
          if (v.indexOf('\n') !== -1) {
            recEndValid = false;
            let n = 0;
            let idx = v.indexOf('\n');
            while (idx !== -1) {
              n += 1;
              idx = v.indexOf('\n', idx + 1);
            }
            line += n;
          }
          pos = closed + 1;
          if (pos >= len) {
            value = v;
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              value = v;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              value = v;
              ended = LINE_BREAK;
            } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = v;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up to the
              // next comma or line break.
              const r = readUnquoted(text, len, pos, v, line);
              value = r.value;
              ended = r.ended;
              pos = r.pos;
              line = r.line;
              for (let i = 0; i < r.stray; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        quoted = false;
        // ---- an unquoted field, inlined (the hot path) ----
        if (pos >= len) {
          value = '';
          ended = END;
        } else if (recEndValid) {
          const comma = text.indexOf(',', pos);
          if (recEnd === -1) {
            if (comma === -1) {
              value = text.slice(pos);
              pos = len;
              ended = END;
            } else {
              value = text.slice(pos, comma);
              pos = comma + 1;
              ended = COMMA;
            }
          } else if (comma !== -1 && comma < recEnd) {
            value = text.slice(pos, comma);
            pos = comma + 1;
            ended = COMMA;
          } else {
            let fend = recEnd;
            if (recEnd > pos && text.charCodeAt(recEnd - 1) === 13) fend = recEnd - 1;
            value = text.slice(pos, fend);
            pos = recEnd + 1;
            line += 1;
            ended = LINE_BREAK;
          }
          // A CR inside the kept span is a stray one: drop it, count it. (A CR
          // that ends a CRLF was already cut off above, so none of these is one.)
          if ((recordHasCR || !recEndValid) && value.indexOf('\r') !== -1) {
            const parts = value.split('\r');
            const n = parts.length - 1;
            value = parts.join('');
            for (let i = 0; i < n; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
        } else {
          const comma = text.indexOf(',', pos);
          const nl = text.indexOf('\n', pos);
          if (comma === -1 && nl === -1) {
            value = text.slice(pos);
            pos = len;
            ended = END;
          } else if (nl === -1 || (comma !== -1 && comma < nl)) {
            value = text.slice(pos, comma);
            pos = comma + 1;
            ended = COMMA;
          } else {
            let fend = nl;
            if (nl > pos && text.charCodeAt(nl - 1) === 13) fend = nl - 1;
            value = text.slice(pos, fend);
            pos = nl + 1;
            line += 1;
            ended = LINE_BREAK;
          }
          if ((recordHasCR || !recEndValid) && value.indexOf('\r') !== -1) {
            const parts = value.split('\r');
            const n = parts.length - 1;
            value = parts.join('');
            for (let i = 0; i < n; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
        }
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Reads unquoted characters from `pos` onto `init`, up to the next comma or line
// break: a CR not followed by LF is dropped (counted in stray). Returns the field
// and how it ended, the next position, the line there, how many stray CRs were
// dropped, and how many characters were kept (`added`, the initial value excluded).
// `line` is the line `pos` is on; it is advanced past every line break read.
// Used only for the quoted-field paths (unterminated and junk), which are rare;
// the plain unquoted field is inlined in run() above. The initial value never
// holds a CR (it is '"' or a quoted field already read with its CRs turned to LF),
// so the CR scan starts past it.
function readUnquoted(text, len, pos, init, line) {
  let value;
  let ended;
  let stray = 0;
  let added = 0;
  if (pos >= len) {
    value = init;
    ended = END;
  } else {
    const comma = text.indexOf(',', pos);
    const nl = text.indexOf('\n', pos);
    if (comma === -1 && nl === -1) {
      value = init + text.slice(pos);
      added = len - pos;
      pos = len;
      ended = END;
    } else if (nl === -1 || (comma !== -1 && comma < nl)) {
      value = init + text.slice(pos, comma);
      added = comma - pos;
      pos = comma + 1;
      ended = COMMA;
    } else {
      let fend = nl;
      if (nl > pos && text.charCodeAt(nl - 1) === 13) fend = nl - 1;
      value = init + text.slice(pos, fend);
      added = fend - pos;
      pos = nl + 1;
      line += 1;
      ended = LINE_BREAK;
    }
    const cr = value.indexOf('\r', init.length);
    if (cr !== -1) {
      const parts = value.split('\r');
      stray = parts.length - 1;
      value = parts.join('');
      added -= stray;
    }
  }
  return { value, ended, pos, line, stray, added };
}
