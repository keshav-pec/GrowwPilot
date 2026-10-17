import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Upload, XCircle } from 'lucide-react';
import { matchBulkFiles, useAddImages } from '../../../api/inventory/images';
import { newRequestKey } from '../../../lib/inventory';
import { Button, Modal } from '../../../components/ui';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Bulk photo upload: name each file by the product code ("SKU-000012.jpg", "SKU-000012-2.jpg" for a second photo).
// The matches are shown first; only matched files are uploaded.
export default function BulkPhotosModal({ onClose }) {
  const inputRef = useRef(null);
  const addImages = useAddImages();
  const [files, setFiles] = useState([]);
  const [matches, setMatches] = useState(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }

  async function pick(e) {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = '';
    if (chosen.length === 0) return;
    setChecking(true);
    try {
      const result = await matchBulkFiles(chosen.map((f) => f.name));
      // Files the browser can tell are wrong (type or size) are marked here too
      result.files = result.files.map((m, i) => {
        const file = chosen[i];
        if (m.status !== 'MATCH') return m;
        if (!TYPES.includes(file.type)) return { ...m, status: 'BAD_FILE', message: 'Not a JPEG, PNG or WebP picture' };
        if (file.size > 2 * 1024 * 1024) return { ...m, status: 'BAD_FILE', message: 'Bigger than 2 MB' };
        return m;
      });
      setFiles(chosen);
      setMatches(result.files);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  }

  const ready = (matches ?? []).map((m, i) => ({ ...m, file: files[i] })).filter((m) => m.status === 'MATCH');

  async function uploadAll() {
    setProgress({ done: 0, total: ready.length });
    let failed = 0;
    for (const [n, m] of ready.entries()) {
      try {
        await addImages.mutateAsync({ key: newRequestKey(), skuId: m.skuId, files: [m.file] });
      } catch {
        failed += 1;
      }
      setProgress({ done: n + 1, total: ready.length });
    }
    if (failed === 0) toast.success(`${ready.length} photo${ready.length === 1 ? '' : 's'} added`);
    else toast.error(`${ready.length - failed} added, ${failed} could not be added (you may not be allowed to change those products)`);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size={matches ? 'wide' : 'md'}
      title="Upload photos in bulk"
      footer={
        matches && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={uploadAll} loading={Boolean(progress)} disabled={ready.length === 0}>
              {progress ? `Uploading ${progress.done} of ${progress.total}` : `Upload ${ready.length} photo${ready.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )
      }
    >
      {!matches ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            Name each photo by its product code, for example <strong className="text-ink">SKU-000012.jpg</strong>. For a second photo of the same product use{' '}
            <strong className="text-ink">SKU-000012-2.jpg</strong>. You’ll see which product each file belongs to before anything is uploaded.
          </p>
          <Button className="self-start" onClick={() => inputRef.current?.click()} loading={checking}>
            <Upload size={16} /> Choose photos
          </Button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={pick} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.fileName} className="border-t border-border">
                  <td className="px-3 py-2">{m.fileName}</td>
                  <td className="px-3 py-2">{m.skuName ? `${m.skuName} (${m.code})` : '—'}</td>
                  <td className="px-3 py-2">
                    {m.status === 'MATCH' ? (
                      <span className="flex items-center gap-1 text-good">
                        <CheckCircle2 size={16} /> Ready
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-danger">
                        <XCircle size={16} /> {m.message}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
