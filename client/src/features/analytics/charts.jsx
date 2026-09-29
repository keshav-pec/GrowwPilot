import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Every chart here shows ONE series, so every bar is the same colour (no rainbow bars)
const BAR_COLOR = '#6B4226'; // brand brown
const GRID_COLOR = '#E5E5E0'; // hairline, one shade off the surface
const MUTED = '#6B6B6B';

// Horizontal bars: good for comparing named things (stylists, services, sources).
// data: [{ name, ...values }] · valueKey: which number to draw · format: how to show it
export function HBarChart({ data, valueKey, format = (v) => v, label }) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">No data for this period.</p>;

  return (
    // Height grows with the number of rows, and includes the axis, so nothing gets cut off
    <div style={{ height: data.length * 36 + 40 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
          <XAxis type="number" tickFormatter={format} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: '#111111' }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: '#F7F7F5' }}
            formatter={(value) => [format(value), label]}
            contentStyle={{ borderRadius: 8, borderColor: GRID_COLOR, fontSize: 12 }}
          />
          {/* Rounded only at the data end (4px), anchored to the axis */}
          <Bar dataKey={valueKey} fill={BAR_COLOR} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Heatmap colours: ONE hue (brown), light = few bookings, dark = many.
// Checked with the palette validator: lightness goes steadily light -> dark, neighbours are visibly
// different, and even the lightest step (1 booking) stands out from an empty cell (2.14:1).
const RAMP = ['#CDA888', '#B68A64', '#9E704A', '#845738', '#6B4226'];
const EMPTY = '#F7F7F5';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

// Bookings by weekday x hour. Hover a cell for the exact number; the busiest slots are also listed as text.
export function SlotHeatmap({ hours, slots }) {
  const max = Math.max(0, ...slots.map((s) => s.count));
  const color = (count) => (count === 0 ? EMPTY : RAMP[Math.min(RAMP.length - 1, Math.floor((count / max) * (RAMP.length - 1e-9)))]);
  const countAt = (day, hour) => slots.find((s) => s.day === day && s.hour === hour)?.count ?? 0;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} className="px-0.5 text-[10px] font-normal text-muted">
                  {hourLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((dayName, i) => (
              <tr key={dayName}>
                <th className="pr-2 text-left text-xs font-normal text-muted">{dayName}</th>
                {hours.map((h) => {
                  const count = countAt(i + 1, h);
                  return (
                    <td
                      key={h}
                      title={`${dayName} ${hourLabel(h)}: ${count} booking${count === 1 ? '' : 's'}`}
                      aria-label={`${dayName} ${hourLabel(h)}: ${count} bookings`}
                      className="h-7 w-8 min-w-7 rounded"
                      style={{ backgroundColor: color(count) }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Scale legend */}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        Fewer
        {[EMPTY, ...RAMP].map((c) => (
          <span key={c} className="h-3 w-5 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        More {max > 0 && <span>(busiest hour: {max} booking{max === 1 ? '' : 's'})</span>}
      </div>
    </div>
  );
}
