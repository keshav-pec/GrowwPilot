import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/ui';
import UploadCard from './UploadCard';
import ImportPreview from './ImportPreview';

// Products → Import: upload a CSV, check every row, then add the products in one go
export default function ImportModal({ onClose }) {
  const [checked, setChecked] = useState(null); // { batch, rows, fileName }

  function done(result) {
    toast.success(`Added ${result.created} product${result.created === 1 ? '' : 's'}${result.withStock ? `, ${result.withStock} with opening stock` : ''}`);
    onClose();
  }

  return (
    <Modal open onClose={onClose} size={checked ? 'wide' : 'md'} title={checked ? `Check before saving: ${checked.fileName}` : 'Import products'}>
      {checked ? (
        <ImportPreview
          batch={checked.batch}
          rows={checked.rows}
          fileName={checked.fileName}
          onBatchChange={(next) => setChecked((c) => ({ ...c, ...next }))}
          onCommitted={done}
          onCancel={() => setChecked(null)}
        />
      ) : (
        <UploadCard onChecked={setChecked} />
      )}
    </Modal>
  );
}
