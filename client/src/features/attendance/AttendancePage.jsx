import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAttendance, useAttendanceSummary, useMarkAttendance } from '../../api/attendance';
import { addDays, formatDay, formatTime, todayIn } from '../../lib/time';
import { Button, EmptyState, Input, PageHeader, Spinner, Table, Tabs } from '../../components/ui';

const STATUSES = [
  { value: 'present', label: 'Present', active: 'border-brown bg-brown text-white' },
  { value: 'absent', label: 'Absent', active: 'border-orange bg-orange text-white' },
  { value: 'leave', label: 'Leave', active: 'border-gold bg-gold text-ink' },
];

// UTC time from the server -> "14:05" for a time input
const toInputTime = (iso, zone) => (iso ? DateTime.fromISO(iso, { zone }).toFormat('HH:mm') : '');

// One stylist's row: Present / Absent / Leave buttons, plus check-in and check-out when present
function RosterRow({ staff, attendance, date, zone, isToday }) {
  const mark = useMarkAttendance();
  const status = attendance?.status;

  function save(values, successMessage) {
    mark.mutate(
      { staffId: staff._id, date, status: status ?? 'present', ...values },
      {
        onSuccess: ({ affectedBookings }) => {
          // Absent with bookings: warn, so someone reassigns them (they also show in Requires attention)
          if (affectedBookings.length > 0) {
            toast(`${staff.name} has ${affectedBookings.length} booking(s) on this day. Please reassign them.`, { icon: '⚠️' });
          } else if (successMessage) {
            toast.success(successMessage);
          }
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const nowTime = DateTime.now().setZone(zone).toFormat('HH:mm');

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
      <div className="sm:w-44">
        <p className="font-medium">{staff.name}</p>
        <p className="text-xs text-muted">
          {staff.role}
          {!status && <span className="ml-1 text-orange">· not marked</span>}
        </p>
      </div>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={mark.isPending}
            onClick={() => save({ status: s.value }, `${staff.name}: ${s.label.toLowerCase()}`)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${status === s.value ? `${s.active} font-medium` : 'border-border hover:bg-surface'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {status === 'present' && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {attendance.checkInAt || !isToday ? (
            <label className="flex items-center gap-1 text-xs text-muted">
              In
              <Input type="time" className="w-28" defaultValue={toInputTime(attendance.checkInAt, zone)} onBlur={(e) => e.target.value !== toInputTime(attendance.checkInAt, zone) && save({ checkIn: e.target.value })} />
            </label>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => save({ checkIn: nowTime }, `${staff.name} checked in`)}>
              Check in now
            </Button>
          )}
          {attendance.checkOutAt || !isToday ? (
            <label className="flex items-center gap-1 text-xs text-muted">
              Out
              <Input type="time" className="w-28" defaultValue={toInputTime(attendance.checkOutAt, zone)} onBlur={(e) => e.target.value !== toInputTime(attendance.checkOutAt, zone) && save({ checkOut: e.target.value })} />
            </label>
          ) : (
            attendance.checkInAt && (
              <Button size="sm" variant="secondary" onClick={() => save({ checkOut: nowTime }, `${staff.name} checked out`)}>
                Check out now
              </Button>
            )
          )}
          {attendance.checkInAt && attendance.checkOutAt && (
            <span className="text-xs text-muted">
              {formatTime(attendance.checkInAt, zone)} – {formatTime(attendance.checkOutAt, zone)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function DailyRoster({ date, setDate }) {
  const { activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const isToday = date === todayIn(zone);
  const attendanceQuery = useAttendance(date);
  const rows = attendanceQuery.data?.rows ?? [];
  const count = (status) => rows.filter((r) => r.attendance?.status === status).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeft size={16} />
        </Button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-border px-2 py-1.5 text-sm" />
        <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          <ChevronRight size={16} />
        </Button>
        <span className="text-sm text-muted">
          {formatDay(date)}
          {isToday && ' (today)'}
        </span>
        {rows.length > 0 && (
          <span className="text-sm text-muted sm:ml-auto">
            Present {count('present')} · Absent {count('absent')} · Leave {count('leave')} · Not marked {rows.filter((r) => !r.attendance).length}
          </span>
        )}
      </div>

      {attendanceQuery.isPending ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No stylists at this branch" message="The owner can add stylists under Team." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ staff, attendance }) => (
            // key includes the times, so the time boxes refresh after saving
            <RosterRow key={`${staff._id}-${attendance?.checkInAt}-${attendance?.checkOutAt}`} staff={staff} attendance={attendance} date={date} zone={zone} isToday={isToday} />
          ))}
        </div>
      )}
    </>
  );
}

function MonthlySummary({ month, setMonth }) {
  const summaryQuery = useAttendanceSummary(month);
  const columns = [
    { key: 'name', header: 'Stylist', render: (r) => <span className="font-medium">{r.staff.name}</span> },
    { key: 'present', header: 'Present' },
    { key: 'absent', header: 'Absent', render: (r) => <span className={r.absent ? 'text-orange' : ''}>{r.absent}</span> },
    { key: 'leave', header: 'Leave' },
    { key: 'notMarked', header: 'Not marked', render: (r) => <span className="text-muted">{r.notMarked}</span> },
  ];

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
        {summaryQuery.data && <span className="text-sm text-muted">{summaryQuery.data.daysSoFar} day(s) counted</span>}
      </div>
      <Table columns={columns} rows={summaryQuery.data?.rows.map((r) => ({ ...r, _id: r.staff._id }))} loading={summaryQuery.isPending} />
    </>
  );
}

export default function AttendancePage() {
  const { user, activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = user.role === 'OWNER';
  const tab = isOwner && searchParams.get('tab') === 'summary' ? 'summary' : 'daily';
  const date = searchParams.get('date') || todayIn(zone);
  const month = searchParams.get('month') || todayIn(zone).slice(0, 7);

  const setParam = (key, value) =>
    setSearchParams((params) => {
      params.set(key, value);
      return params;
    });

  return (
    <>
      <PageHeader title="Staff attendance" subtitle={`${activeBranch.name} · absent or on-leave stylists can’t be booked`} />
      {isOwner && (
        <Tabs
          tabs={[
            { value: 'daily', label: 'Daily roster' },
            { value: 'summary', label: 'Monthly summary' },
          ]}
          value={tab}
          onChange={(value) => setParam('tab', value)}
        />
      )}
      {tab === 'daily' ? <DailyRoster date={date} setDate={(d) => setParam('date', d)} /> : <MonthlySummary month={month} setMonth={(m) => setParam('month', m)} />}
    </>
  );
}
