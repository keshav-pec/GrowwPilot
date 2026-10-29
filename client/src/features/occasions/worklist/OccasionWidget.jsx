import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useOfferSummary } from '../../../api/occasions';
import { Card } from '../../../components/ui';

// "Customer occasions — this month" on the owner Dashboard and the front desk Today page.
// Shown only while the feature is switched on. "Open list" opens Action required for this branch and month.
export default function OccasionWidget() {
  const { user } = useAuth();
  const on = Boolean(user.org?.occasionOffers?.enabled);
  const summaryQuery = useOfferSummary({}, on);
  if (!on || summaryQuery.isError) return null;
  const s = summaryQuery.data;

  return (
    <Card
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <Gift size={18} /> Customer occasions — this month
        </span>
      }
      actions={
        <Link to="/app/occasions?tab=action" className="text-sm font-medium text-brown underline">
          Open list
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Eligible', s?.eligible],
          ['Needs action', s?.needsAction],
          ['Booked', s?.booked],
          ['Used', s?.used],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="text-xl font-bold text-brown">{value ?? '…'}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
