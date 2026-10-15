import toast from 'react-hot-toast';
import { CheckCircle2, Circle } from 'lucide-react';
import { useMarkSetupStep } from '../../../api/inventory/setup';
import { newRequestKey } from '../../../lib/inventory';
import { Button, Card } from '../../../components/ui';

// Stays on the Overview until the branch's setup is finished
export default function SetupChecklist({ setup, onContinue }) {
  const markStep = useMarkSetupStep();
  const items = [
    ['Check where you keep stock', setup.steps.locations],
    [setup.counts.products > 0 ? `Add your products (${setup.counts.products} so far)` : 'Add your products', setup.steps.products],
    ['Set reorder levels', setup.steps.reorderLevels],
  ];

  function markFinished() {
    markStep.mutate({ key: newRequestKey(), step: 'done' }, { onSuccess: () => toast.success('Inventory is set up'), onError: (err) => toast.error(err.message) });
  }

  return (
    <Card title="Finish setting up inventory" className="mb-4 border-gold/60 bg-yellow-soft/40">
      <ul className="mb-4 space-y-2 text-sm">
        {items.map(([label, done]) => (
          <li key={label} className="flex items-center gap-2">
            {done ? <CheckCircle2 size={18} className="text-good" /> : <Circle size={18} className="text-muted" />}
            <span className={done ? 'text-muted line-through' : 'text-ink'}>{label}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onContinue}>Continue setup</Button>
        <Button variant="ghost" onClick={markFinished} loading={markStep.isPending}>
          Mark as finished
        </Button>
      </div>
    </Card>
  );
}
