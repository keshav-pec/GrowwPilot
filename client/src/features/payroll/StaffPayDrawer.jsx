import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useCancelPayPlan, useEndPayPlan, useStaffPay } from '../../api/payroll';
import { describePay, formatPayDay, modelLabel } from '../../lib/payroll';
import { Badge, Button, ConfirmDialog, Drawer, Input, Spinner } from '../../components/ui';
import PayPlanFormModal from './PayPlanFormModal';
import PayRequestCard from './PayRequestCard';
import ServiceRatesSection from './ServiceRatesSection';
import CommissionSection from './CommissionSection';
import AdvancesSection from './AdvancesSection';

const PLAN_STATUS = {
  current: { label: 'Current', tone: 'brown' },
  upcoming: { label: 'Upcoming', tone: 'gold' },
  past: { label: 'Ended', tone: 'neutral' },
};

function Section({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function dateRange(plan) {
  return plan.effectiveTo ? `${formatPayDay(plan.effectiveFrom)} – ${formatPayDay(plan.effectiveTo)}` : `From ${formatPayDay(plan.effectiveFrom)}`;
}

// "Stop paying from a date", e.g. someone is leaving
function EndPlanModal({ plan, staffName, today, onClose }) {
  const endPlan = useEndPayPlan();
  const [lastDay, setLastDay] = useState(today);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      danger
      title={`End ${staffName}'s pay?`}
      confirmLabel="End pay"
      loading={endPlan.isPending}
      onConfirm={() =>
        endPlan.mutate(
          { planId: plan._id, effectiveTo: lastDay },
          {
            onSuccess: () => {
              toast.success('Pay ended');
              onClose();
            },
            onError: (err) => toast.error(err.message),
          }
        )
      }
      message={
        <div className="space-y-3">
          <p>Use this when someone leaves. Pay they earned up to their last day is still owed.</p>
          <Input label="Last paid day" type="date" value={lastDay} min={plan.effectiveFrom} onChange={(e) => setLastDay(e.target.value)} />
        </div>
      }
    />
  );
}

// One person's pay: what they get now, what's coming, open requests and (owners) the full history
export default function StaffPayDrawer({ staffId, onClose }) {
  const { user } = useAuth();
  const isOwner = user.role === 'OWNER';
  const payQuery = useStaffPay(staffId);
  const cancelPlan = useCancelPayPlan();
  const [form, setForm] = useState(null); // { mode, plan? }
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [ending, setEnding] = useState(false);

  const data = payQuery.data;
  const pending = data?.requests.find((r) => r.status === 'pending');
  // Only the newest setup can be edited, cancelled or ended (owners get the full history to tell)
  const latest = isOwner ? data?.history[0] : (data?.upcoming ?? data?.current);
  const canEnd = isOwner && data?.current && latest?._id === data.current._id;

  const footer = data && (
    <>
      {canEnd && (
        <Button variant="ghost" className="mr-auto" onClick={() => setEnding(true)}>
          End pay
        </Button>
      )}
      {isOwner ? (
        <Button onClick={() => setForm({ mode: 'create' })}>{data.current || data.upcoming ? 'Change pay' : 'Set up pay'}</Button>
      ) : (
        <Button onClick={() => setForm({ mode: 'request' })} disabled={Boolean(pending)}>
          Request a change
        </Button>
      )}
    </>
  );

  return (
    <>
      <Drawer open onClose={onClose} title={data ? `${data.staff.name} · Pay` : 'Pay'} footer={footer}>
        {payQuery.isPending ? (
          <Spinner size={24} />
        ) : payQuery.isError ? (
          <p className="text-sm text-danger">{payQuery.error.message}</p>
        ) : (
          <>
            <Section title="Paid now">
              {data.current ? (
                <>
                  <p className="text-lg font-semibold text-ink">{describePay(data.current)}</p>
                  <p className="text-sm text-muted">
                    {modelLabel(data.current.model)} · {dateRange(data.current)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  No pay setup yet.{' '}
                  {isOwner ? 'Click “Set up pay” to choose how they’re paid.' : 'Click “Request a change” to ask an owner to set it up.'}
                </p>
              )}
            </Section>

            {data.upcoming && (
              <Section title="Upcoming change">
                <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
                  <p className="font-medium text-ink">{describePay(data.upcoming)}</p>
                  <p className="text-sm text-muted">Starts {formatPayDay(data.upcoming.effectiveFrom)}</p>
                  {isOwner && latest?._id === data.upcoming._id && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setForm({ mode: 'edit', plan: data.upcoming })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                        Cancel change
                      </Button>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {isOwner && <CommissionSection staffId={data.staff._id} today={data.today} />}

            <ServiceRatesSection staff={data.staff} rates={data.serviceRates} normalBps={data.current?.commissionBps} isOwner={isOwner} />

            {isOwner && <AdvancesSection staff={data.staff} today={data.today} />}

            {pending && (
              <Section title="Request waiting">
                <PayRequestCard request={pending} />
              </Section>
            )}
            {!isOwner && pending && <p className="-mt-3 mb-4 text-xs text-muted">You can send a new request once this one is answered.</p>}

            {isOwner && data.history.length > 0 && (
              <Section title="History">
                <ul className="space-y-2">
                  {data.history.map((plan) => (
                    <li key={plan._id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{describePay(plan)}</span>
                        <Badge tone={PLAN_STATUS[plan.status].tone}>{PLAN_STATUS[plan.status].label}</Badge>
                      </div>
                      <p className="text-muted">{dateRange(plan)}</p>
                      <p className="text-xs text-muted">
                        Set by {plan.createdBy?.name ?? 'someone'}
                        {plan.requestId && ' (front desk request)'}
                        {plan.note && ` · “${plan.note}”`}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </Drawer>

      {form && data && (
        <PayPlanFormModal
          mode={form.mode}
          plan={form.plan}
          staff={data.staff}
          current={data.current}
          latest={form.mode === 'edit' ? null : latest}
          today={data.today}
          onClose={() => setForm(null)}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() =>
          cancelPlan.mutate(data.upcoming._id, {
            onSuccess: () => {
              toast.success('Upcoming change cancelled');
              setConfirmCancel(false);
            },
            onError: (err) => toast.error(err.message),
          })
        }
        loading={cancelPlan.isPending}
        title="Cancel this upcoming pay change?"
        message={data?.upcoming && `${describePay(data.upcoming)} from ${formatPayDay(data.upcoming.effectiveFrom)} won’t happen. Their current pay carries on.`}
        confirmLabel="Cancel change"
        danger
      />

      {ending && <EndPlanModal plan={data.current} staffName={data.staff.name} today={data.today} onClose={() => setEnding(false)} />}
    </>
  );
}
