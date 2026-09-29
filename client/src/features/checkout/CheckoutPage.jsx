import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAppointment } from '../../api/appointments';
import { useCreateInvoice } from '../../api/invoices';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui';

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
];

// Rupees typed in a box -> paise (empty or invalid counts as 0)
const paiseOf = (text) => (isValidRupees(text) ? toPaise(text) : 0);

export default function CheckoutPage() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const appointmentQuery = useAppointment(appointmentId);
  const createInvoice = useCreateInvoice();

  const [discountType, setDiscountType] = useState('flat'); // 'flat' (₹) or 'percent' (%)
  const [discountText, setDiscountText] = useState('');
  const [payments, setPayments] = useState([{ method: 'CASH', amount: '', reference: '' }]);

  if (appointmentQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  const appointment = appointmentQuery.data;
  if (appointmentQuery.isError) return <EmptyState title="Appointment not found" message={appointmentQuery.error.message} />;
  if (appointment.invoiceId) return <Navigate to={`/app/invoices/${appointment.invoiceId}`} replace />; // already paid
  if (appointment.status !== 'COMPLETED') {
    return (
      <EmptyState
        title="Not ready for checkout"
        message="Only completed appointments can be checked out. Mark the service complete first."
        action={<Link to="/app/today" className="text-sm underline">Back to the day board</Link>}
      />
    );
  }

  // ----- The same maths as the server (which checks it again) -----
  const subtotal = appointment.totalPrice;
  const itemsTotal = appointment.items.reduce((sum, i) => sum + i.price, 0);
  const discountNumber = Number(discountText) || 0;
  const discount = discountType === 'percent' ? Math.round((subtotal * discountNumber) / 100) : paiseOf(discountText);
  const discountError =
    discountText && (discountType === 'percent' ? !(discountNumber >= 0 && discountNumber <= 100) : !isValidRupees(discountText))
      ? 'Enter a valid discount'
      : discount > subtotal
        ? `Can’t be more than ${formatMoney(subtotal)}`
        : null;
  const total = Math.max(subtotal - discount, 0);
  const paid = payments.reduce((sum, p) => sum + paiseOf(p.amount), 0);
  const remaining = total - paid;
  const badAmount = payments.some((p) => !isValidRupees(p.amount) || paiseOf(p.amount) === 0);
  const canPay = !discountError && remaining === 0 && (total === 0 || !badAmount);

  function updatePayment(index, field, value) {
    setPayments((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  // "Rest" button: put whatever is still unpaid into this row
  function fillRest(index) {
    const others = payments.reduce((sum, p, i) => (i === index ? sum : sum + paiseOf(p.amount)), 0);
    updatePayment(index, 'amount', String(Math.max(total - others, 0) / 100));
  }

  function pay() {
    createInvoice.mutate(
      {
        appointmentId,
        discountType,
        discountValue: discountType === 'percent' ? discountNumber : discount,
        payments: total === 0 ? [] : payments.map((p) => ({ method: p.method, amount: paiseOf(p.amount), reference: p.reference.trim() || undefined })),
      },
      {
        onSuccess: (invoice) => {
          toast.success(`Paid · ${invoice.invoiceNumber}`);
          navigate(`/app/invoices/${invoice._id}`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <>
      <PageHeader title="Checkout" subtitle={`${appointment.customerSnapshot.name} · ${formatDateTime(appointment.startAt, activeBranch.timezone)}`} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bill">
          <ul className="divide-y divide-border text-sm">
            {appointment.items.map((item) => (
              <li key={item._id} className="flex justify-between py-2">
                <span>
                  {item.serviceName} <span className="text-muted">· {item.staffName}</span>
                </span>
                <span>{formatMoney(item.price)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-sm">
            {appointment.comboId && itemsTotal !== subtotal && (
              <div className="flex justify-between text-muted">
                <span>Combo price</span>
                <span>−{formatMoney(itemsTotal - subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>

            <div className="flex items-start gap-2">
              <span className="pt-2">Discount</span>
              <div className="ml-auto flex rounded-lg border border-border p-0.5">
                {['flat', 'percent'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDiscountType(type)}
                    className={`rounded-md px-3 py-1 ${discountType === type ? 'bg-gold font-medium text-ink' : 'text-muted'}`}
                  >
                    {type === 'flat' ? '₹' : '%'}
                  </button>
                ))}
              </div>
              <div className="w-32">
                <Input inputMode="decimal" placeholder="0" value={discountText} onChange={(e) => setDiscountText(e.target.value)} error={discountError} aria-label="Discount" />
              </div>
            </div>
            {discount > 0 && !discountError && (
              <div className="flex justify-between text-muted">
                <span>{discountType === 'percent' ? `${discountNumber}% off` : 'Discount'}</span>
                <span>−{formatMoney(discount)}</span>
              </div>
            )}

            <div className="flex justify-between border-t border-border pt-2 text-lg font-bold text-brown">
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </div>
          </div>
        </Card>

        <Card title="Payment">
          {total === 0 ? (
            <p className="text-sm text-muted">Nothing to pay (100% discount).</p>
          ) : (
            <div className="flex flex-col gap-3">
              {payments.map((payment, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
                  <Select options={METHODS} value={payment.method} onChange={(e) => updatePayment(index, 'method', e.target.value)} aria-label="Method" />
                  <div className="relative">
                    <Input inputMode="decimal" placeholder="Amount ₹" value={payment.amount} onChange={(e) => updatePayment(index, 'amount', e.target.value)} aria-label="Amount" />
                    <button type="button" onClick={() => fillRest(index)} className="absolute right-2 top-2 rounded bg-surface px-1.5 text-xs text-muted hover:text-ink">
                      Rest
                    </button>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Input placeholder="Reference (optional)" value={payment.reference} onChange={(e) => updatePayment(index, 'reference', e.target.value)} aria-label="Reference" />
                  </div>
                  <Button variant="ghost" onClick={() => setPayments((rows) => rows.filter((_, i) => i !== index))} disabled={payments.length === 1} aria-label="Remove payment">
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
              {payments.length < 5 && (
                <Button variant="secondary" size="sm" className="self-start" onClick={() => setPayments((rows) => [...rows, { method: 'UPI', amount: '', reference: '' }])}>
                  <Plus size={14} /> Add payment method
                </Button>
              )}
            </div>
          )}

          {/* Remaining: the Pay button only works at exactly ₹0 */}
          <div
            className={`mt-4 flex justify-between rounded-lg px-3 py-2 text-sm font-medium ${
              remaining === 0 ? 'bg-brown/10 text-brown' : 'bg-orange/10 text-orange'
            }`}
          >
            <span>{remaining >= 0 ? 'Remaining' : 'Too much by'}</span>
            <span>{formatMoney(Math.abs(remaining))}</span>
          </div>

          <Button className="mt-4 w-full" onClick={pay} disabled={!canPay} loading={createInvoice.isPending}>
            Pay {formatMoney(total)}
          </Button>
        </Card>
      </div>
    </>
  );
}
