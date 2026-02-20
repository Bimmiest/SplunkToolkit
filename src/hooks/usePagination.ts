import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

export function usePagination<T>(items: T[]) {
  const currentPage = useAppStore((s) => s.currentPage);
  const eventsPerPage = useAppStore((s) => s.eventsPerPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setEventsPerPage = useAppStore((s) => s.setEventsPerPage);

  const totalPages = Math.max(1, Math.ceil(items.length / eventsPerPage));

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * eventsPerPage;
    return items.slice(start, start + eventsPerPage);
  }, [items, currentPage, eventsPerPage]);

  return {
    paginatedItems,
    currentPage,
    totalPages,
    eventsPerPage,
    totalItems: items.length,
    setCurrentPage,
    setEventsPerPage,
  };
}
