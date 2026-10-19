import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCreateSale } from '../../api/invoices';
import { Button, Modal } from '../../components/ui';
import CustomerPicker from '../appointments/CustomerPicker';

// "New sale" on the Bills page: products only. Pick the customer, or sell to a guest (if the salon allows it).
export default function NewSaleModal({ onClose }) {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const createSale = useCreateSale();

  function start(customerId) {
    createSale.mutate(
      { customerId },
      {
        onSuccess: (invoice) => navigate(`/app/bills/${invoice._id}/edit`),
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New sale"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => start(null)} loading={createSale.isPending && !customer}>
            Sell to a guest
          </Button>
          <Button onClick={() => start(customer._id)} disabled={!customer} loading={createSale.isPending && Boolean(customer)}>
            Start the bill
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">For selling products without an appointment. Services are billed from their appointment.</p>
      <CustomerPicker customer={customer} onChange={setCustomer} />
    </Modal>
  );
}
