import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useInvoice } from '../../api/invoices';
import { Badge, EmptyState, PageHeader, Spinner } from '../../components/ui';
import DraftEditor from '../checkout/DraftEditor';

// A product-only sale while it's a draft (made with "New sale" on the Bills page)
export default function SaleEditPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const invoiceQuery = useInvoice(id);
  const [loads, setLoads] = useState(0); // goes up when the draft is reloaded, so the editor starts again from it

  if (invoiceQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (invoiceQuery.isError) return <EmptyState title="Bill not found" message={invoiceQuery.error.message} />;
  const draft = invoiceQuery.data;
  if (draft.status !== 'DRAFT') return <Navigate to={`/app/invoices/${draft._id}`} replace />;
  if (draft.appointmentId) return <Navigate to={`/app/checkout/${draft.appointmentId._id}`} replace />;

  return (
    <>
      <PageHeader title="New sale" subtitle={draft.customerSnapshot?.name ?? 'Guest'} actions={<Badge>Draft bill</Badge>} />
      <DraftEditor
        key={loads}
        draft={draft}
        onReplace={(invoice) => queryClient.setQueryData(['invoice', invoice._id], invoice)}
        onStale={() => invoiceQuery.refetch().then(() => setLoads((n) => n + 1))}
      />
    </>
  );
}
