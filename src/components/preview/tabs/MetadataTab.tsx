import { useAppStore } from '../../../store/useAppStore';
import { usePagination } from '../../../hooks/usePagination';
import { EventPagination } from '../EventPagination';

export function MetadataTab() {
  const result = useAppStore((s) => s.processingResult);
  const originalMetadata = useAppStore((s) => s.metadata);

  const events = result?.events ?? [];
  const { paginatedItems, currentPage, totalPages, eventsPerPage, totalItems, setCurrentPage, setEventsPerPage } = usePagination(events);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-3">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              <th className="py-2 px-3 font-medium">#</th>
              <th className="py-2 px-3 font-medium">index</th>
              <th className="py-2 px-3 font-medium">host</th>
              <th className="py-2 px-3 font-medium">source</th>
              <th className="py-2 px-3 font-medium">sourcetype</th>
              <th className="py-2 px-3 font-medium">_time</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((event, idx) => {
              const globalIdx = (currentPage - 1) * eventsPerPage + idx + 1;
              return (
                <tr key={idx} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-tertiary)]">
                  <td className="py-2 px-3 text-[var(--color-text-muted)] font-mono">{globalIdx}</td>
                  <td className="py-2 px-3 font-mono">
                    <MetadataCell value={event.metadata.index} original={originalMetadata.index} />
                  </td>
                  <td className="py-2 px-3 font-mono">
                    <MetadataCell value={event.metadata.host} original={originalMetadata.host} />
                  </td>
                  <td className="py-2 px-3 font-mono">
                    <MetadataCell value={event.metadata.source} original={originalMetadata.source} />
                  </td>
                  <td className="py-2 px-3 font-mono">
                    <MetadataCell value={event.metadata.sourcetype} original={originalMetadata.sourcetype} />
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">
                    {event._time ? event._time.toISOString() : <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalItems > eventsPerPage && (
        <EventPagination
          currentPage={currentPage} totalPages={totalPages} totalItems={totalItems}
          eventsPerPage={eventsPerPage} onPageChange={setCurrentPage} onEventsPerPageChange={setEventsPerPage}
        />
      )}
    </div>
  );
}

function MetadataCell({ value, original }: { value: string; original: string }) {
  const changed = value !== original && value !== '';
  return (
    <span className={changed ? 'text-[var(--color-warning)] font-semibold' : ''}>
      {value || <span className="text-[var(--color-text-muted)]">—</span>}
    </span>
  );
}
