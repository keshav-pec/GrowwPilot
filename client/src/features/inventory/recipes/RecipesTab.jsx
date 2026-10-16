import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { DateTime } from 'luxon';
import { useRecipes } from '../../../api/inventory/recipes';
import { describeRecipe } from '../../../lib/inventory';
import { Badge, EmptyState, Spinner } from '../../../components/ui';
import RecipeModal from './RecipeModal';

// Service recipes (INV-09): what each service uses. Owners edit; inventory logins can look.
export default function RecipesTab({ can }) {
  const recipesQuery = useRecipes();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  if (recipesQuery.isPending) return <Spinner size={24} />;
  if (recipesQuery.isError) return <p className="text-sm text-danger">{recipesQuery.error.message}</p>;

  const words = search.trim().toLowerCase();
  const rows = recipesQuery.data.filter((r) => !words || `${r.service.name} ${r.service.category ?? ''}`.toLowerCase().includes(words));
  const open = recipesQuery.data.find((r) => r.service._id === openId);

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        When a service is marked completed, the products in its recipe are taken from stock automatically. A recipe can be for every branch or just
        this one; this branch’s own recipe wins.
      </p>
      <label className="relative mb-4 block">
        <span className="sr-only">Search services</span>
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services"
          className="w-full rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        />
      </label>

      {rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No services" message="Services offered at this branch show here." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => {
            const recipe = r.applies === 'branch' ? r.branch.current : r.salon.current;
            const upcoming = [...r.branch.upcoming, ...r.salon.upcoming][0];
            return (
              <li key={r.service._id}>
                <button type="button" onClick={() => setOpenId(r.service._id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-yellow-soft sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{r.service.name}</p>
                    <p className="text-sm text-muted">{r.applies ? describeRecipe(recipe) : 'No recipe: takes no stock'}</p>
                    {upcoming && <p className="text-xs text-brown">Changes on {DateTime.fromISO(upcoming.effectiveFrom).toFormat('d LLL, h:mm a')}</p>}
                  </div>
                  {r.applies && <Badge tone={r.applies === 'branch' ? 'gold' : 'brown'}>{r.applies === 'branch' ? 'This branch' : 'All branches'}</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && <RecipeModal row={open} can={can} onClose={() => setOpenId(null)} />}
    </>
  );
}
