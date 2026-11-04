// A report as a table: columns [{ key, label, money? }], rows, and an optional totals row.
// cell(column, row): what to show in a cell. Money columns line up on the right.
export default function ReportTable({ columns, rows, totals, cell }) {
  const align = (c) => (c.money ? 'text-right' : '');
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${align(c)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${align(c)}`}>
                  {cell(c, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t border-border font-semibold text-brown">
              {columns.map((c, i) => (
                <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${align(c)}`}>
                  {i === 0 ? 'Total' : c.key in totals ? cell(c, totals) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
