import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.ts';

describe('CSV export sanitiser', () => {
  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('keeps real numbers numeric (negative stays negative)', () => {
    expect(csvCell(-3.5)).toBe('-3.5');
    expect(csvCell(0)).toBe('0');
  });

  it('quotes cells with commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('writes null/undefined as an empty cell and builds CRLF rows', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(toCsv(['a', 'b'], [[1, null], ['x', '=1']])).toBe("a,b\r\n1,\r\nx,'=1");
  });
});
