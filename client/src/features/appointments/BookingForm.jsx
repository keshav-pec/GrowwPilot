import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { AlertTriangle, Target } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useSaveAppointment } from '../../api/appointments';
import { useConvertLead } from '../../api/leads';
import { useCombos, useServices } from '../../api/catalog';
import { useStaff } from '../../api/staff';
import { useAttendance } from '../../api/attendance';
import { formatMoney } from '../../lib/money';
import { formatDay } from '../../lib/time';
import { Button, Card, Input, Select, Textarea } from '../../components/ui';
import CustomerPicker from './CustomerPicker';
import SlotPicker from './SlotPicker';

const SOURCES = [
  { value: 'phone', label: 'Phone call' },
  { value: 'walk-in', label: 'Walk-in' },
];

// initial: starting values (empty for a new booking, filled in when editing)
// leadInfo: { lead, matchingCustomer } when converting a lead (the customer comes from the lead's phone)
export default function BookingForm({ initial, appointmentId, leadInfo }) {
  const navigate = useNavigate();
  const { activeBranch, activeBranchId } = useAuth();
  const zone = activeBranch.timezone;
  const isEdit = Boolean(appointmentId);

  const services = useServices().data ?? [];
  const combos = useCombos().data ?? [];
  const activeStaff = (useStaff().data ?? []).filter((s) => s.status === 'active');
  const saveAppointment = useSaveAppointment();
  const convertLead = useConvertLead();
  const lead = leadInfo?.lead;

  // ----- Form state -----
  const [customer, setCustomer] = useState(initial.customer ?? null);
  const [mode, setMode] = useState(initial.mode ?? 'services'); // 'services' or 'combo'
  const [serviceIds, setServiceIds] = useState(initial.serviceIds ?? []);
  const [comboId, setComboId] = useState(initial.comboId ?? '');
  const [chosenStaffId, setDefaultStaffId] = useState(initial.defaultStaffId ?? '');
  const [overrides, setOverrides] = useState(initial.overrides ?? {}); // per service: { staffId, durationMinutes }
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime ?? '');
  const [source, setSource] = useState('phone');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [conflict, setConflict] = useState(null); // message when another desk took the slot

  // Stylists marked absent or on leave for the chosen day can't be booked, so they're hidden
  const attendanceRows = useAttendance(date).data?.rows ?? [];
  const isAway = (staffId) => attendanceRows.some((r) => r.staff._id === staffId && ['absent', 'leave'].includes(r.attendance?.status));
  const staff = activeStaff.filter((s) => !isAway(s._id));
  const awayNames = activeStaff.filter((s) => isAway(s._id)).map((s) => s.name);

  // Only what can be booked at this branch
  const offeredHere = (x) => x.status === 'active' && (x.branchIds.length === 0 || x.branchIds.includes(activeBranchId));
  const bookableServices = services.filter(offeredHere);
  const bookableCombos = combos.filter((c) => offeredHere(c) && c.serviceIds.every((s) => s.status === 'active'));
  const combo = mode === 'combo' ? combos.find((c) => c._id === comboId) : null;
  // A stylist passed in (e.g. the customer's preferred one) only counts if they're active at this branch
  const defaultStaffId = staff.some((s) => s._id === chosenStaffId) ? chosenStaffId : '';

  // Anything that changes the length or stylist makes the chosen time out of date
  const resetTime = () => setStartTime('');

  function toggleService(id) {
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    resetTime();
  }

  function chooseCombo(id) {
    setComboId(id);
    setServiceIds(combos.find((c) => c._id === id)?.serviceIds.map((s) => s._id) ?? []);
    resetTime();
  }

  function switchMode(newMode) {
    setMode(newMode);
    setServiceIds([]);
    setComboId('');
    resetTime();
  }

  function setOverride(serviceId, field, value) {
    setOverrides((o) => ({ ...o, [serviceId]: { ...o[serviceId], [field]: value } }));
    resetTime();
  }

  // ----- The items, back to back (same logic as the server, just for the preview) -----
  let cursor = startTime ? DateTime.fromISO(`${date}T${startTime}`, { zone }) : null;
  const items = serviceIds.map((id) => {
    const service = services.find((s) => s._id === id);
    const override = overrides[id] ?? {};
    // A typed duration counts once it's a real number (5+ min); otherwise the service / branch default
    const custom = Number(override.durationMinutes);
    const duration = custom >= 5 ? custom : service?.durationMinutes || activeBranch.defaultServiceMinutes;
    const start = cursor;
    if (cursor) cursor = cursor.plus({ minutes: duration });
    return { id, service, staffId: override.staffId || defaultStaffId, duration, customDuration: custom >= 5 ? custom : undefined, start, end: cursor };
  });
  const totalMinutes = items.reduce((sum, item) => sum + item.duration, 0);
  const totalPrice = combo ? combo.comboPrice : items.reduce((sum, item) => sum + (item.service?.price ?? 0), 0);

  const missing = !customer && !lead ? 'Choose a customer' : items.length === 0 ? 'Choose a service' : !defaultStaffId ? 'Choose a stylist' : !startTime ? 'Pick a time' : null;

  function submit() {
    setConflict(null);
    const payload = {
      _id: appointmentId,
      date,
      startTime,
      items: items.map((item) => ({
        serviceId: item.id,
        staffId: item.staffId,
        durationMinutes: item.customDuration,
      })),
      comboId: combo?._id,
      notes: notes.trim() || undefined,
      ...(isEdit || lead ? {} : { customerId: customer._id, source }), // a lead's customer is found by phone on the server
    };

    const when = `${formatDay(date)} at ${DateTime.fromFormat(startTime, 'HH:mm').toFormat('h:mm a')}`;
    const onError = (err) => {
      if (err.code === 'SLOT_TAKEN') {
        // Another desk booked it first. The free times refresh automatically.
        setConflict(err.message);
        resetTime();
      } else {
        toast.error(err.message);
      }
    };

    // Converting a lead: one request books, links or creates the customer, and closes the lead
    if (lead) {
      convertLead.mutate(
        { ...payload, _id: lead._id },
        {
          onSuccess: (result) => {
            toast.success(
              result.isExistingCustomer
                ? `Booked ${when}, linked to ${result.customer.name}'s profile`
                : `Booked ${when}. New customer ${result.customer.name} created`
            );
            navigate(`/app/today?date=${date}`);
          },
          onError,
        }
      );
      return;
    }

    saveAppointment.mutate(payload, {
      onSuccess: () => {
        toast.success(`${isEdit ? 'Updated' : 'Booked'}: ${customer.name}, ${when}`);
        navigate(`/app/today?date=${date}`);
      },
      onError,
    });
  }

  const staffOptions = staff.map((s) => ({ value: s._id, label: s.name }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card title="1. Customer">
          {lead ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <Target size={16} className="text-gold-dark" />
                <div>
                  <p className="font-medium">{lead.name}</p>
                  <p className="text-xs text-muted">From lead · {lead.phone}</p>
                </div>
              </div>
              {leadInfo.matchingCustomer ? (
                <p className="rounded-lg bg-yellow-soft px-3 py-2 text-sm">
                  Existing customer found: <strong>{leadInfo.matchingCustomer.name}</strong>. The booking will be linked to their profile.
                </p>
              ) : (
                <p className="text-sm text-muted">A new customer profile will be created for {lead.name} when you confirm.</p>
              )}
            </div>
          ) : (
            <CustomerPicker customer={customer} onChange={setCustomer} locked={isEdit} />
          )}
        </Card>

        <Card
          title="2. Services"
          actions={
            <div className="flex rounded-lg border border-border p-0.5 text-sm">
              {['services', 'combo'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`rounded-md px-3 py-1 ${mode === m ? 'bg-gold font-medium text-ink' : 'text-muted'}`}
                >
                  {m === 'services' ? 'Services' : 'Combo'}
                </button>
              ))}
            </div>
          }
        >
          {mode === 'services' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {bookableServices.map((s) => (
                <label
                  key={s._id}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                    serviceIds.includes(s._id) ? 'border-gold bg-yellow-soft' : 'border-border'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={serviceIds.includes(s._id)} onChange={() => toggleService(s._id)} className="accent-gold" />
                    {s.name}
                  </span>
                  <span className="text-muted">
                    {formatMoney(s.price)} · {s.durationMinutes ?? activeBranch.defaultServiceMinutes} min
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <Select
              placeholder="Choose a combo"
              options={bookableCombos.map((c) => ({
                value: c._id,
                label: `${c.name} (${c.serviceIds.map((s) => s.name).join(' + ')}) · ${formatMoney(c.comboPrice)}`,
              }))}
              value={comboId}
              onChange={(e) => chooseCombo(e.target.value)}
            />
          )}
        </Card>

        <Card title="3. Stylist">
          <Select
            placeholder="Choose a stylist"
            options={staffOptions}
            value={defaultStaffId}
            onChange={(e) => {
              setDefaultStaffId(e.target.value);
              resetTime();
            }}
          />
          <p className="mt-2 text-xs text-muted">The same stylist does every service. You can change it for a single service below.</p>
          {awayNames.length > 0 && <p className="mt-1 text-xs text-orange">Not available on this day: {awayNames.join(', ')}</p>}
        </Card>

        <Card title="4. Date and time">
          <div className="mb-3 max-w-xs">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                resetTime();
              }}
            />
          </div>
          {conflict && (
            <div className="mb-3 flex gap-2 rounded-lg border border-orange bg-orange/10 p-3 text-sm">
              <AlertTriangle size={18} className="shrink-0 text-orange" />
              <p>
                <strong>This slot was just booked by another desk. Please pick another time.</strong>
                <br />
                <span className="text-muted">{conflict}</span>
              </p>
            </div>
          )}
          <SlotPicker date={date} staffId={defaultStaffId} duration={totalMinutes} excludeAppointmentId={appointmentId} value={startTime} onChange={setStartTime} />
          {new Set(items.map((i) => i.staffId)).size > 1 && (
            <p className="mt-2 text-xs text-muted">Free times shown for the main stylist. The other stylist is checked when you confirm.</p>
          )}
        </Card>
      </div>

      {/* 5. Summary */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card title="5. Review">
          {items.length === 0 ? (
            <p className="text-sm text-muted">No services chosen yet.</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border border-border p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{item.service?.name}</span>
                    <span>{formatMoney(item.service?.price ?? 0)}</span>
                  </div>
                  {item.start && (
                    <p className="text-xs text-muted">
                      {item.start.toFormat('h:mm a')} – {item.end.toFormat('h:mm a')}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Select options={staffOptions} value={item.staffId} onChange={(e) => setOverride(item.id, 'staffId', e.target.value)} aria-label="Stylist" />
                    <Input
                      type="number"
                      min={5}
                      value={overrides[item.id]?.durationMinutes ?? item.duration}
                      onChange={(e) => setOverride(item.id, 'durationMinutes', e.target.value)}
                      aria-label="Minutes"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 flex justify-between border-t border-border pt-3 text-sm">
            <span className="text-muted">{totalMinutes} min</span>
            <span className="font-semibold">
              {formatMoney(totalPrice)}
              {combo && <span className="ml-1 text-xs font-normal text-muted">combo price</span>}
            </span>
          </div>

          {!isEdit && !lead && (
            <div className="mb-3">
              <Select label="How did they book?" options={SOURCES} value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
          )}
          <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

          <Button className="mt-4 w-full" onClick={submit} disabled={Boolean(missing)} loading={saveAppointment.isPending || convertLead.isPending}>
            {missing || (isEdit ? 'Save changes' : lead ? 'Book and convert lead' : 'Confirm booking')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
