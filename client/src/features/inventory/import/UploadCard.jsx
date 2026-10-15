import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { usePreviewImport } from '../../../api/inventory/imports';
import { COLUMN_HELP, downloadExample, downloadTemplate, readImportFile } from '../../../lib/inventoryCsv';
import { Button } from '../../../components/ui';

// Pick a CSV file: the browser reads it, the server checks every row, and nothing is saved yet.
// onChecked({ batch, rows, fileName }) gets the checked rows for the "check before saving" step.
export default function UploadCard({ onChecked }) {
  const inputRef = useRef(null);
  const previewImport = usePreviewImport();
  const [problem, setProblem] = useState(null);
  const [reading, setReading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still works
    if (!file) return;
    setProblem(null);
    setReading(true);
    const { rows, problem: fileProblem } = await readImportFile(file);
    setReading(false);
    if (fileProblem) return setProblem(fileProblem);
    previewImport.mutate(
      { fileName: file.name, rows },
      { onSuccess: (batch) => onChecked({ batch, rows, fileName: file.name }), onError: (err) => setProblem(err.message) }
    );
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileSpreadsheet size={20} className="text-brown" />
        <h3 className="font-semibold text-brown">Upload a spreadsheet (CSV)</h3>
      </div>
      <p className="mb-3 text-sm text-muted">
        Fill in the template in Excel or Google Sheets, save it as CSV and upload it. You’ll see every row before anything is saved.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => inputRef.current?.click()} loading={reading || previewImport.isPending}>
          <Upload size={16} /> Choose CSV file
        </Button>
        <Button variant="secondary" onClick={downloadTemplate}>
          <Download size={16} /> Download template
        </Button>
        <Button variant="ghost" onClick={downloadExample}>
          <Download size={16} /> Filled-in example
        </Button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </div>
      {problem && <p className="mb-3 text-sm text-danger">{problem}</p>}
      <dl className="space-y-1 text-xs">
        {COLUMN_HELP.map(([columns, help]) => (
          <div key={columns}>
            <dt className="inline font-medium text-ink">{columns}: </dt>
            <dd className="inline text-muted">{help}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
