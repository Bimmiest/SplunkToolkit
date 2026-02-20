import { useState, useRef, useEffect } from 'react';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const activeCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors cursor-pointer"
        style={{
          backgroundColor: activeCount > 0 ? 'var(--color-accent)' : 'var(--color-bg-primary)',
          color: activeCount > 0 ? '#fff' : 'var(--color-text-secondary)',
          borderColor: activeCount > 0 ? 'var(--color-accent)' : 'var(--color-border)',
        }}
      >
        <span>{label}</span>
        {activeCount > 0 && (
          <span className="bg-white/25 rounded-full px-1 text-[10px] leading-4">{activeCount}</span>
        )}
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && options.length > 0 && (
        <div
          className="absolute top-full left-0 mt-1 z-50 min-w-[160px] max-h-[240px] overflow-auto rounded border shadow-lg"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
          }}
        >
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-[var(--color-bg-tertiary)] transition-colors"
              style={{ color: 'var(--color-text-primary)' }}
            >
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                className="rounded accent-[var(--color-accent)]"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
          {activeCount > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="w-full px-2.5 py-1.5 text-xs text-left border-t cursor-pointer transition-colors"
              style={{
                color: 'var(--color-text-muted)',
                borderColor: 'var(--color-border)',
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
