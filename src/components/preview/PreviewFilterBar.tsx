import { MultiSelect } from '../ui/MultiSelect';

interface PreviewFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  allFields: string[];
  selectedFields: Set<string>;
  onFieldsChange: (fields: Set<string>) => void;
  selectedStatus: Set<string>;
  onStatusChange: (status: Set<string>) => void;
  selectedModification: Set<string>;
  onModificationChange: (mod: Set<string>) => void;
  filteredCount: number;
  totalCount: number;
}

const STATUS_OPTIONS = ['Accepted', 'Dropped'];
const MODIFICATION_OPTIONS = ['Raw Modified', 'Metadata Modified', 'Unmodified'];

export function PreviewFilterBar({
  search,
  onSearchChange,
  allFields,
  selectedFields,
  onFieldsChange,
  selectedStatus,
  onStatusChange,
  selectedModification,
  onModificationChange,
  filteredCount,
  totalCount,
}: PreviewFilterBarProps) {
  const hasFilters = search || selectedFields.size > 0 || selectedStatus.size > 0 || selectedModification.size > 0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="relative flex-1 max-w-[240px]">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{ color: 'var(--color-text-muted)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-7 pr-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <MultiSelect
        label="Fields"
        options={allFields}
        selected={selectedFields}
        onChange={onFieldsChange}
      />
      <MultiSelect
        label="Status"
        options={STATUS_OPTIONS}
        selected={selectedStatus}
        onChange={onStatusChange}
      />
      <MultiSelect
        label="Changes"
        options={MODIFICATION_OPTIONS}
        selected={selectedModification}
        onChange={onModificationChange}
      />
      {hasFilters && (
        <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
          {filteredCount}/{totalCount}
        </span>
      )}
    </div>
  );
}
