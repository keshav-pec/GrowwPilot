import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { useRequestPayChange, useSavePayPlan } from '../../api/payroll';
import { formatAmount, isValidRupees, toPaise } from '../../lib/money';
import { PARTS_BY_MODEL, PAY_MODELS, PAY_PARTS, describePay, firstOfMonth, formatPayDay, formatPercent } from '../../lib/payroll';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';

const amount = z.string().trim().refine((v) => v === '' || isValidRupees(v), 'Enter an amount like 20000 or 499.50');
const percent = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100), 'Enter a % between 0 and 100');

// The front desk must give a reason; owners may add a note
function buildSchema(isRequest) {
  return z
    .object({
      model: z.string(),
      monthlyBase: amount,
      dailyRate: amount,
      hourlyRate: amount,
      assignmentRate: amount,
      commissionBps: percent, // typed as a % here, sent as basis points
      effectiveFrom: z.string().min(1, 'Choose a start date'),
      note: isRequest ? z.string().trim().min(3, 'Please give a reason for the change').max(500) : z.string().trim().max(500),
    })
    .superRefine((values, ctx) => {
      const used = PARTS_BY_MODEL[values.model];
      const filled = used.filter((key) => Number(values[key]) > 0);
      if (values.model === 'HYBRID') {
        if (filled.length < 2) ctx.addIssue({ code: 'custom', path: ['model'], message: 'Fill in at least two of the parts below' });
      } else {
        for (const key of used) if (!filled.includes(key)) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
      }
    });
}

// Form text -> what the server expects (paise, basis points, null for unused parts)
function toPayload(values) {
  const used = PARTS_BY_MODEL[values.model];
  const payload = { model: values.model, effectiveFrom: values.effectiveFrom, note: values.note.trim() || undefined };
  for (const { key } of PAY_PARTS) {
    const filled = used.includes(key) && Number(values[key]) > 0;
    payload[key] = !filled ? null : key === 'commissionBps' ? Math.round(Number(values[key]) * 100) : toPaise(values[key]);
  }
  return payload;
}

// Saved plan -> form text
function toFormValues(plan) {
  const text = (paise) => (paise ? String(paise / 100) : '');
  return {
    model: plan?.model ?? 'FIXED',
    monthlyBase: text(plan?.monthlyBase),
    dailyRate: text(plan?.dailyRate),
    hourlyRate: text(plan?.hourlyRate),
    assignmentRate: text(plan?.assignmentRate),
    commissionBps: plan?.commissionBps ? String(plan.commissionBps / 100) : '',
  };
}

// A worked example so the owner can check the numbers make sense
const EXAMPLE = { days: 26, hours: 208, services: 100, sales: 10000000 }; // sales: ₹1,00,000 in paise

function ExampleMonth({ payload }) {
  if (payload.commissionBps > 10000 || Object.values(payload).some((v) => Number.isNaN(v))) return null;
  const lines = [];
  if (payload.monthlyBase) lines.push(['Monthly salary', payload.monthlyBase]);
  if (payload.dailyRate) lines.push([`${EXAMPLE.days} days × ${formatAmount(payload.dailyRate)}`, payload.dailyRate * EXAMPLE.days]);
  if (payload.hourlyRate) lines.push([`${EXAMPLE.hours} hours × ${formatAmount(payload.hourlyRate)}`, payload.hourlyRate * EXAMPLE.hours]);
  if (payload.assignmentRate) lines.push([`${EXAMPLE.services} services × ${formatAmount(payload.assignmentRate)}`, payload.assignmentRate * EXAMPLE.services]);
  if (payload.commissionBps) {
    lines.push([`${formatPercent(payload.commissionBps)} of ${formatAmount(EXAMPLE.sales)} of services`, Math.round((EXAMPLE.sales * payload.commissionBps) / 10000)]);
  }
  if (lines.length === 0) return null;

  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-sm sm:col-span-2">
      <p className="mb-1 font-medium text-ink">Example month</p>
      {lines.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 text-muted">
          <span>{label}</span>
          <span>{formatAmount(value)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium text-ink">
        <span>Total</span>
        <span>{formatAmount(lines.reduce((sum, [, value]) => sum + value, 0))}</span>
      </div>
      <p className="mt-1 text-xs text-muted">Only an example. Real pay will be worked out from attendance and paid services.</p>
    </div>
  );
}

// mode: 'create' (owner adds a pay change), 'edit' (owner edits an upcoming change), 'request' (front desk asks)
// current: the setup paying them today. latest: the newest setup (maybe an upcoming one), used to fill the form.
export default function PayPlanFormModal({ mode, staff, current, latest, plan, today, onClose }) {
  const isRequest = mode === 'request';
  const savePlan = useSavePayPlan();
  const requestChange = useRequestPayChange();
  const mutation = isRequest ? requestChange : savePlan;

  // First setup: from the 1st of this month. A change: from the 1st of the month after the newest setup starts.
  const defaultStart = plan?.effectiveFrom ?? (latest ? firstOfMonth(latest.effectiveFrom > today ? latest.effectiveFrom : today, 1) : firstOfMonth(today));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(buildSchema(isRequest)),
    defaultValues: { ...toFormValues(plan ?? latest), effectiveFrom: defaultStart, note: '' },
  });

  const values = watch();
  const model = PAY_MODELS.find((m) => m.value === values.model);
  const used = PARTS_BY_MODEL[values.model] ?? [];

  function onSubmit(formValues) {
    const payload = toPayload(formValues);
    const request = isRequest ? { staffId: staff._id, ...payload } : { planId: plan?._id, staffId: staff._id, ...payload };
    mutation.mutate(request, {
      onSuccess: () => {
        toast.success(isRequest ? 'Request sent to the owner for approval' : `${staff.name}'s pay saved`);
        onClose();
      },
    });
  }

  const title = { create: `How do you pay ${staff.name}?`, edit: `Edit ${staff.name}'s upcoming pay change`, request: `Request a pay change for ${staff.name}` }[mode];

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="pay-form" loading={mutation.isPending}>
            {isRequest ? 'Send for approval' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="pay-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {current && mode !== 'edit' && (
          <p className="text-sm text-muted sm:col-span-2">
            Now: <span className="font-medium text-ink">{describePay(current)}</span> since {formatPayDay(current.effectiveFrom)}
          </p>
        )}

        <div className="sm:col-span-2">
          <Select label="How are they paid?" options={PAY_MODELS} error={errors.model?.message} hint={model?.hint} {...register('model')} />
        </div>

        {PAY_PARTS.filter((part) => used.includes(part.key)).map((part) => (
          <Input key={part.key} label={part.label} inputMode="decimal" error={errors[part.key]?.message} {...register(part.key)} />
        ))}

        <Input label="Starts from" type="date" error={errors.effectiveFrom?.message} {...register('effectiveFrom')} />

        {values.effectiveFrom && values.effectiveFrom < today && (
          <p className="flex gap-2 rounded-lg bg-yellow-soft px-3 py-2 text-sm text-ink sm:col-span-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" />
            This date is in the past. Pay from {formatPayDay(values.effectiveFrom)} onwards will use this new setup. Commission already worked out for those days stays as it was.
          </p>
        )}

        <div className="sm:col-span-2">
          <Textarea
            label={isRequest ? 'Reason for the change' : 'Note (optional)'}
            placeholder={isRequest ? 'e.g. Yearly raise agreed with the owner' : 'e.g. Promoted to senior stylist'}
            rows={2}
            error={errors.note?.message}
            {...register('note')}
          />
        </div>

        {/* Only once the numbers are valid, so a typo doesn't show a silly total */}
        {PAY_PARTS.every((part) => !errors[part.key]) && <ExampleMonth payload={toPayload(values)} />}

        {isRequest && <p className="text-xs text-muted sm:col-span-2">An owner will approve this before it takes effect.</p>}
        {mutation.isError && <p className="text-sm text-danger sm:col-span-2">{mutation.error.message}</p>}
      </form>
    </Modal>
  );
}
