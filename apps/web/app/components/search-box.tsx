'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');

  // Keep the box in sync when landing on /search?q=…
  useEffect(() => {
    setQ(params.get('q') ?? '');
  }, [params]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length >= 2) router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form className="search-box" onSubmit={submit} role="search">
      <span className="material-symbols-outlined search-icon">search</span>
      <input
        type="search"
        placeholder="Search pages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search pages"
      />
    </form>
  );
}
