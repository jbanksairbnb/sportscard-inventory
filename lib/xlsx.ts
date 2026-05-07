import ExcelJS from 'exceljs';

export type ColumnDef = {
  key: string;
  header: string;
  width?: number;
  // Data-validation list values; renders as a dropdown in Excel.
  list?: string[];
  // Help text shown when the cell is selected.
  help?: string;
};

export type ExampleRow = Record<string, string | number | null | undefined>;

// Builds a template workbook with two sheets:
//   "Transactions" — header + example rows; dropdowns on any column with a `list`.
//   "Instructions" — human-readable directions, including the save-as-CSV step.
// The same dropdown is applied to a generous range of rows (default 500) so
// the user can paste new data and still get validation.
export async function buildTemplateWorkbook(opts: {
  sheetName: string;
  columns: ColumnDef[];
  examples: ExampleRow[];
  instructions: string[];
  validationRows?: number;
}): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sports Collective';
  wb.created = new Date();

  const ws = wb.addWorksheet(opts.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = opts.columns.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(c.header.length + 4, 14),
  }));

  // Style header row.
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFF8ECD0' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D1F4A' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;

  // Add example rows.
  for (const ex of opts.examples) {
    ws.addRow(ex);
  }

  // Apply data validation to columns that have a list. Range covers the
  // header offset (row 2) through validationRows for paste-safety.
  const lastRow = (opts.validationRows ?? 500) + 1;
  opts.columns.forEach((col, i) => {
    const colLetter = ws.getColumn(i + 1).letter;
    if (col.list && col.list.length > 0) {
      for (let r = 2; r <= lastRow; r++) {
        const cell = ws.getCell(`${colLetter}${r}`);
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${col.list.join(',')}"`],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Invalid value',
          error: `Use one of: ${col.list.join(', ')}`,
        };
      }
    }
    if (col.help) {
      const headerCell = ws.getCell(`${colLetter}1`);
      headerCell.note = { texts: [{ text: col.help }] };
    }
  });

  // Instructions sheet.
  const ins = wb.addWorksheet('Instructions');
  ins.getColumn(1).width = 110;
  opts.instructions.forEach((line, i) => {
    const row = ins.getRow(i + 1);
    row.getCell(1).value = line;
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) {
      row.font = { bold: true, size: 14, color: { argb: 'FF3D1F4A' } };
      row.height = 22;
    } else {
      row.font = { size: 12, color: { argb: 'FF2C1B33' } };
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
