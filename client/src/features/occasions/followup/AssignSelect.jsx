import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAssignOffer, useAssignees } from '../../../api/occasions';
import { newRequestKey } from '../../../lib/billing';
import { Select } from '../../../components/ui';

// Assign the follow-up to a front desk person of the customer's branch, or an owner. The history is kept.
export default function AssignSelect({ offer, disabled }) {
  const assigneesQuery = useAssignees(offer._id);
  const assign = useAssignOffer();
  const [key, setKey] = useState(newRequestKey);
  const options = (assigneesQuery.data ?? []).map((u) => ({ value: u._id, label: `${u.name} (${u.role})` }));

  function change(e) {
    assign.mutate(
      { key, offerId: offer._id, assigneeId: e.target.value || null },
      {
        onSuccess: () => {
          setKey(newRequestKey());
          toast.success('Assigned');
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Select
      aria-label="Assigned to"
      placeholder="Anyone at the branch"
      options={options}
      value={offer.task?.assigneeId ?? ''}
      disabled={disabled || assign.isPending || assigneesQuery.isPending}
      onChange={change}
    />
  );
}
