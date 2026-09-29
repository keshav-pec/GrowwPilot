import { DateTime } from 'luxon';
import { useAvailability } from '../../api/appointments';
import { Spinner } from '../../components/ui';

// Free start times for the chosen stylist. Refreshes every 60 s. The server still has the final say.
// excludeAppointmentId: when editing, the appointment's own current time counts as free
export default function SlotPicker({ date, staffId, duration, excludeAppointmentId, value, onChange }) {
  const availability = useAvailability({ date, staffId, duration, excludeAppointmentId });

  if (!staffId || !duration) return <p className="text-sm text-muted">Choose services and a stylist to see free times.</p>;
  if (availability.isPending) return <Spinner />;
  if (availability.isError) return <p className="text-sm text-danger">{availability.error.message}</p>;

  const { slots, reason } = availability.data;
  if (slots.length === 0) return <p className="text-sm text-orange">{reason || 'No free time left on this day.'}</p>;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
      {slots.map((slot) => (
        <button
          key={slot}
          type="button"
          onClick={() => onChange(slot)}
          className={`whitespace-nowrap rounded-lg border px-2 py-1.5 text-sm ${
            value === slot ? 'border-gold bg-gold font-medium text-ink' : 'border-border hover:border-gold hover:bg-yellow-soft'
          }`}
        >
          {DateTime.fromFormat(slot, 'HH:mm').toFormat('h:mm a')}
        </button>
      ))}
    </div>
  );
}
