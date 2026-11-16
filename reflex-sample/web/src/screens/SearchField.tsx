import { useEffect, useState } from "react";

/** Keeps the half-typed text locally; sends `Search` after a pause or on Enter. */
export function SearchField({ value, placeholder, onSearch }: { value: string; placeholder: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft.trim() === value) return;
    const t = setTimeout(() => onSearch(draft), 400);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="search" onSubmit={(e) => (e.preventDefault(), onSearch(draft))}>
      <span className="search-icon">⌕</span>
      <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} type="search" />
    </form>
  );
}
