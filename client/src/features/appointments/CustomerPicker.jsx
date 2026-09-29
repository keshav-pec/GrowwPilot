import { useState } from 'react';
import toast from 'react-hot-toast';
import { Search, UserPlus } from 'lucide-react';
import { useCreateCustomer, useCustomerSearch } from '../../api/customers';
import { useDebounce } from '../../lib/useDebounce';
import { isValidPhone } from '../../lib/phone';
import { Button, Input, Spinner } from '../../components/ui';

// Step 1 of booking: find the customer by phone or name, or add a new one right here
export default function CustomerPicker({ customer, onChange, locked = false }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const results = useCustomerSearch(debounced);
  const createCustomer = useCreateCustomer();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
        <div>
          <p className="font-medium">{customer.name}</p>
          <p className="text-xs text-muted">{customer.phone}</p>
        </div>
        {!locked && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        )}
      </div>
    );
  }

  function startAdding() {
    // If they typed a phone number in the search box, reuse it
    const typedDigits = search.replace(/\D/g, '');
    setNewPhone(typedDigits.length >= 10 ? search : '');
    setNewName(typedDigits.length >= 10 ? '' : search);
    setAdding(true);
  }

  function addCustomer() {
    createCustomer.mutate(
      { name: newName, phone: newPhone },
      {
        onSuccess: (created) => {
          toast.success(`Added ${created.name}`);
          onChange(created);
        },
        onError: (err) => {
          // Phone already exists: use that customer instead of creating a duplicate
          if (err.code === 'CUSTOMER_EXISTS') {
            toast.success(`${err.message}. The booking will be linked to their profile.`);
            onChange(err.details.customer);
          } else {
            toast.error(err.message);
          }
        },
      }
    );
  }

  if (adding) {
    const canSave = newName.trim().length >= 2 && isValidPhone(newPhone);
    return (
      <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
        <Input label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        <Input
          label="Phone"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          error={newPhone && !isValidPhone(newPhone) ? 'Enter a valid 10-digit mobile number' : undefined}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button onClick={addCustomer} disabled={!canSave} loading={createCustomer.isPending}>
            Add customer
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Back to search
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-2.5 text-muted" />
        <Input placeholder="Search by phone or name" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" autoFocus />
      </div>

      {results.isFetching && <Spinner size={18} />}
      {results.data?.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {results.data.map((c) => (
            <li key={c._id}>
              <button type="button" onClick={() => onChange(c)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-yellow-soft">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.data?.length === 0 && <p className="text-sm text-muted">No customer found.</p>}

      <Button variant="secondary" onClick={startAdding} className="self-start">
        <UserPlus size={16} /> New customer
      </Button>
    </div>
  );
}
