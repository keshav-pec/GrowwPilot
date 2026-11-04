import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from './useDebounce';

// List filters that live in the URL, so a refresh keeps them. The search box updates the URL 300 ms after typing stops.
export function useUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  function setFilter(key, value) {
    setSearchParams(
      (params) => {
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true }
    );
  }

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    setFilter('search', debouncedSearch);
  }, [debouncedSearch]);

  return { searchParams, setFilter, search, setSearch, debouncedSearch };
}
