import Spinner from './Spinner';
import EmptyState from './EmptyState';

// columns: [{ key: 'name', header: 'Name', render: (row) => ... }]
// If a column has no render function, row[key] is shown as it is.
export default function Table({ columns, rows = [], rowKey = '_id', loading = false, empty, onRowClick }) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }

  if (rows.length === 0) {
    return empty || <EmptyState title="Nothing here yet" />;
  }

  return (
    // overflow-x-auto lets wide tables scroll sideways on phones
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="whitespace-nowrap px-4 py-3 font-medium">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-t border-border ${onRowClick ? 'cursor-pointer hover:bg-yellow-soft' : ''}`}
            >
              {columns.map((col) => (
                <td key={col.key} className="whitespace-nowrap px-4 py-3">
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
