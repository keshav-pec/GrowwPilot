import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRightLeft, BellRing, Check, PackagePlus, Repeat2 } from 'lucide-react';
import { useMarkSetupStep } from '../../../api/inventory/setup';
import { newRequestKey } from '../../../lib/inventory';
import { Button } from '../../../components/ui';
import LocationsCard from '../settings/LocationsCard';
import UploadCard from '../import/UploadCard';
import ImportPreview from '../import/ImportPreview';
import ProductFormModal from '../products/ProductFormModal';
import IssueModal from '../actions/IssueModal';
import FinishModal from '../actions/FinishModal';

const STEPS = ['Where you keep stock', 'Add your products', 'Check before saving', 'Done'];

// First-time setup for a branch, in four short steps. Every step can be skipped and picked up later
// (the Overview keeps a "Finish setting up" checklist until it is finished).
export default function SetupGuide({ setup, can, onLeave, onFinished, onOpenProducts }) {
  const markStep = useMarkSetupStep();
  const [step, setStep] = useState(setup.steps.locations ? 2 : 1);
  const [checked, setChecked] = useState(null); // an uploaded file: { batch, rows, fileName }
  const [imported, setImported] = useState(null); // { created, withStock }
  const [adding, setAdding] = useState(false);
  const [tryAction, setTryAction] = useState(null); // 'issue' | 'finish'

  function confirmLocations() {
    markStep.mutate({ key: newRequestKey(), step: 'locations' }, { onSuccess: () => setStep(2), onError: (err) => toast.error(err.message) });
  }

  function finish() {
    markStep.mutate(
      { key: newRequestKey(), step: 'done' },
      {
        onSuccess: () => {
          toast.success('Inventory is set up');
          onFinished();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <div className="rounded-xl border border-border p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brown">Let’s set up your inventory</h2>
          <p className="text-sm text-muted">Four short steps. You can skip any of them and come back later.</p>
        </div>
        <Button variant="ghost" onClick={onLeave}>
          Set up later
        </Button>
      </div>

      <ol className="mb-6 grid gap-2 sm:grid-cols-4">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = (n === 1 && setup.steps.locations) || (n === 2 && setup.steps.products) || (n === 3 && imported);
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(n)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                  step === n ? 'border-gold bg-gold/10 font-medium' : 'border-border text-muted hover:bg-surface'
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-good text-white' : 'bg-surface text-ink'}`}>
                  {done ? <Check size={14} /> : n}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <>
          <p className="mb-3 text-sm text-muted">
            Every branch has a <strong className="text-ink">Main store</strong> for stock on the shelf, and <strong className="text-ink">In use</strong> for what is opened or handed out.
            {can['inventory.manageSettings'] ? ' Rename the store if you like, and add stations (chairs or areas) if you hand products to them.' : ' An owner can rename them and add stations.'}
          </p>
          <LocationsCard canEdit={can['inventory.manageSettings']} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Skip
            </Button>
            <Button onClick={confirmLocations} loading={markStep.isPending}>
              Looks right, next
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadCard
              onChecked={(result) => {
                setChecked(result);
                setStep(3);
              }}
            />
            <div className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <PackagePlus size={20} className="text-brown" />
                <h3 className="font-semibold text-brown">Add them one by one</h3>
              </div>
              <p className="mb-3 text-sm text-muted">Good for a handful of products. Only the name, category, stock unit and way of use are needed.</p>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add a product
              </Button>
              {setup.counts.products > 0 && (
                <p className="mt-3 text-sm text-good">
                  {setup.counts.products === 1 ? '1 product' : `${setup.counts.products} products`} at this branch so far.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(4)}>
              Skip for now
            </Button>
            {setup.counts.products > 0 && <Button onClick={() => setStep(4)}>Next</Button>}
          </div>
        </>
      )}

      {step === 3 &&
        (checked ? (
          <ImportPreview
            batch={checked.batch}
            rows={checked.rows}
            fileName={checked.fileName}
            onBatchChange={(next) => setChecked((c) => ({ ...c, ...next }))}
            onCommitted={(result) => {
              setImported(result);
              setChecked(null);
              setStep(4);
            }}
            onCancel={() => {
              setChecked(null);
              setStep(2);
            }}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            <p className="mb-3">There is no file to check. Upload a spreadsheet in step 2, or carry on.</p>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => setStep(4)}>Next</Button>
            </div>
          </div>
        ))}

      {step === 4 && (
        <>
          {imported && (
            <p className="mb-4 rounded-lg bg-surface px-4 py-3 text-sm">
              Added <strong>{imported.created}</strong> product{imported.created === 1 ? '' : 's'}
              {imported.withStock > 0 && `, ${imported.withStock} with opening stock`}.
            </p>
          )}
          <p className="mb-3 text-sm font-medium text-ink">Three things you’ll do most:</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Tip
              icon={ArrowRightLeft}
              title="Issue a product"
              text="Hand a bottle from the store to a stylist or station. It moves to In use."
              action={
                can['inventory.issue'] && (
                  <Button size="sm" variant="secondary" onClick={() => setTryAction('issue')}>
                    Issue a product
                  </Button>
                )
              }
            />
            <Tip
              icon={Repeat2}
              title="Mark a bottle finished"
              text="When it’s empty, mark it finished and hand out a new one in the same step."
              action={
                can['inventory.finish'] && (
                  <Button size="sm" variant="secondary" onClick={() => setTryAction('finish')}>
                    Mark finished
                  </Button>
                )
              }
            />
            <Tip
              icon={BellRing}
              title="Set reorder levels"
              text="Say when to order more, and the product shows “Need to order” in time."
              action={
                <Button size="sm" variant="secondary" onClick={onOpenProducts}>
                  Open products
                </Button>
              }
            />
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={finish} loading={markStep.isPending}>
              Finish setup
            </Button>
          </div>
        </>
      )}

      {adding && <ProductFormModal canSeeCosts={can['inventory.viewCosts']} onClose={() => setAdding(false)} />}
      {tryAction === 'issue' && <IssueModal onClose={() => setTryAction(null)} />}
      {tryAction === 'finish' && <FinishModal canReplace={can['inventory.issue']} onClose={() => setTryAction(null)} />}
    </div>
  );
}

function Tip({ icon: Icon, title, text, action }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={18} className="text-brown" />
        <h3 className="text-sm font-semibold text-brown">{title}</h3>
      </div>
      <p className="mb-3 text-sm text-muted">{text}</p>
      {action}
    </div>
  );
}
