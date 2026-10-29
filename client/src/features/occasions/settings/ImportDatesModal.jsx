import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Upload } from 'lucide-react';
import { downloadDatesTemplate, useImportDates } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { downloadRejected, readDatesFile } from '../../../lib/occasions';
import { Button, Modal, Table } from '../../../components/ui';

const rejectedColumns = [
  { key: 'row', header: 'Row' },
  { key: 'name', header: 'Name', render: (r) => r.name || r.customer_id || '—' },
  { key: 'reason', header: 'Problem' },
];

// Import birthdays and anniversaries (owners): download the template, fill in months and days, upload.
// Every row is checked first and nothing is saved until "Save"; bad rows come back as a rejection file.
export default function ImportDatesModal({ onClose }) {
  const inputRef = useRef(null);
  const importDates = useImportDates();
  const [key] = useState(newRequestKey);
  const [file, setFile] = useState(null); // { name, rows }
  const [check, setCheck] = useState(null); // the check-only result
  const [result, setResult] = useState(null); // after saving
  const [problem, setProblem] = useState(null);

  async function pickFile(e) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setProblem(null);
    setCheck(null);
    const { rows, problem: fileProblem } = await readDatesFile(picked);
    if (fileProblem) return setProblem(fileProblem);
    setFile({ name: picked.name, rows });
    importDates.mutate({ rows, checkOnly: true }, { onSuccess: setCheck, onError: (err) => setProblem(err.message) });
  }

  function save() {
    importDates.mutate(
      { rows: file.rows, checkOnly: false, key },
      {
        onSuccess: (saved) => {
          setResult(saved);
          toast.success(`Saved dates for ${saved.saved} customer${saved.saved === 1 ? '' : 's'}`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const shown = result ?? check;
  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Import birthdays and anniversaries"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {check && !result && (
            <Button onClick={save} disabled={check.toSave === 0} loading={importDates.isPending}>
              Save {check.toSave} customer{check.toSave === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>Download the template. It lists your customers with their ID and a masked phone number.</li>
          <li>Fill in the month (1–12 or a name like November) and, if you know it, the day. Leave a month empty to keep what is saved.</li>
          <li>Save it as CSV and upload it. You’ll see what will change before anything is saved.</li>
        </ol>
        <p className="text-xs text-muted">Rows are matched by customer ID only. Importing never turns on messaging permission.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadDatesTemplate().catch((err) => toast.error(err.message))}>
            <Download size={16} /> Download template
          </Button>
          {!result && (
            <Button onClick={() => inputRef.current?.click()} loading={importDates.isPending && !check}>
              <Upload size={16} /> {file ? 'Choose another file' : 'Upload filled file'}
            </Button>
          )}
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={pickFile} />
        </div>
        {problem && <p className="text-danger">{problem}</p>}

        {shown && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label={result ? 'Saved' : 'Will be saved'} value={result ? result.saved : shown.toSave} />
              <Tile label="No change" value={shown.unchanged} />
              <Tile label="Rejected" value={shown.rejected.length} tone={shown.rejected.length ? 'text-danger' : undefined} />
            </div>
            {result?.skippedChanged > 0 && <p className="text-orange">{result.skippedChanged} customer(s) were changed by someone else while you were importing and were left as they are.</p>}
            {shown.rejected.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-brown">Rejected rows{shown.rejected.length > 50 ? ' (first 50)' : ''}</p>
                  <Button size="sm" variant="ghost" onClick={() => downloadRejected(shown.rejected)}>
                    <Download size={14} /> Download rejection file
                  </Button>
                </div>
                <Table columns={rejectedColumns} rows={shown.rejected.slice(0, 50)} rowKey="row" />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Tile({ label, value, tone = 'text-brown' }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
