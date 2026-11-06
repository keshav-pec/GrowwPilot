import { useState } from 'react';
import toast from 'react-hot-toast';
import { refusalText, useSaveUnits } from '../../api/gst';
import { newRequestKey } from '../../lib/requestKey';
import { Button, Card, Select } from '../../components/ui';

// Table 12 needs an official unit code for each product. Your own words (bottle, jar) are matched to one here.
export default function UnitCodesCard({ setup }) {
  const { rows, codes } = setup.units;
  const save = useSaveUnits();
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.unit, r.code ?? r.suggestion ?? ''])));
  const options = codes.map((code) => ({ value: code, label: code }));
  const changed = rows.some((r) => values[r.unit] && values[r.unit] !== r.code);

  function submit() {
    const units = Object.fromEntries(Object.entries(values).filter(([, code]) => code));
    save.mutate(
      { key: newRequestKey(), units },
      {
        onSuccess: () => toast.success('Unit codes saved'),
        onError: (err) => toast.error(refusalText(err)),
      }
    );
  }

  return (
    <Card
      title="Official unit codes"
      actions={setup.canEdit && (
        <Button size="sm" variant="secondary" disabled={!changed} loading={save.isPending} onClick={submit}>
          Save
        </Button>
      )}
    >
      <p className="mb-3 text-sm text-muted">GSTR-1 needs an official code for each unit your products are sold in. A suggested code isn’t used until you save it.</p>
      <fieldset disabled={!setup.canEdit} className="grid gap-3 sm:grid-cols-3">
        {rows.map((r) => (
          <Select
            key={r.unit}
            label={r.unit}
            placeholder="Choose a code"
            options={options}
            value={values[r.unit]}
            hint={r.code ? undefined : values[r.unit] ? 'Suggested, not saved yet' : 'Needed for returns'}
            onChange={(e) => setValues((v) => ({ ...v, [r.unit]: e.target.value }))}
          />
        ))}
      </fieldset>
    </Card>
  );
}
