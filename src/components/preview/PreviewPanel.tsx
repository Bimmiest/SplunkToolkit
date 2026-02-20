import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Tabs } from '../ui/Tabs';
import type { EventMetadata, OutputTabId, PreviewSubTabId, SplunkEvent } from '../../engine/types';
import { RawTab } from './tabs/RawTab';
import { HighlightedTab } from './tabs/HighlightedTab';
import { DiffTab } from './tabs/DiffTab';
import { CalculatedFieldsTab } from './tabs/CalculatedFieldsTab';
import { TimestampTab } from './tabs/TimestampTab';
import { CimModelsTab } from './tabs/CimModelsTab';
import { FieldsTab } from './tabs/FieldsTab';
import { TransformsTab } from './tabs/TransformsTab';
import { ArchitecturePanel } from '../architecture/ArchitecturePanel';
import { PreviewFilterBar } from './PreviewFilterBar';
import { EventPagination } from './EventPagination';
import { usePagination } from '../../hooks/usePagination';

export interface EnrichedEvent {
  event: SplunkEvent;
  originalRaw: string;
  hasChanges: boolean;
  hasMetadataChanges: boolean;
  isDropped: boolean;
}

function hasMetadataDiff(eventMeta: EventMetadata, originalMeta: EventMetadata): boolean {
  return (
    (eventMeta.index !== originalMeta.index && eventMeta.index !== '') ||
    (eventMeta.host !== originalMeta.host && eventMeta.host !== '') ||
    (eventMeta.source !== originalMeta.source && eventMeta.source !== '') ||
    (eventMeta.sourcetype !== originalMeta.sourcetype && eventMeta.sourcetype !== '')
  );
}

const PREVIEW_SUB_TABS: { id: PreviewSubTabId; label: string }[] = [
  { id: 'raw', label: 'Raw' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'highlighted', label: 'Highlighted' },
  { id: 'calculated', label: 'Calculated Fields' },
  { id: 'diff', label: 'Diff' },
];

export function PreviewPanel() {
  const activeTab = useAppStore((s) => s.activeOutputTab);
  const setActiveTab = useAppStore((s) => s.setActiveOutputTab);
  const result = useAppStore((s) => s.processingResult);
  const tabs = useMemo(() => [
    { id: 'preview', label: 'Preview' },
    { id: 'cim', label: 'CIM Models' },
    { id: 'fields', label: 'Fields' },
    { id: 'transforms', label: 'Transforms' },
    { id: 'architecture', label: 'Architecture' },
  ], []);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2 px-3">
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Output</span>
        </div>
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as OutputTabId)}
          ariaLabel="Output tabs"
        />
      </div>
      <div
        className="flex-1 min-h-0 overflow-auto"
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        <TabContent tab={activeTab} hasData={!!result && result.events.length > 0} />
      </div>
    </div>
  );
}

function TabContent({ tab, hasData }: { tab: OutputTabId; hasData: boolean }) {
  if (tab === 'architecture') return <ArchitecturePanel embedded />;

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        Paste raw data and configure props.conf to see output
      </div>
    );
  }

  switch (tab) {
    case 'preview': return <PreviewSubTab />;
    case 'cim': return <CimModelsTab />;
    case 'fields': return <FieldsTab />;
    case 'transforms': return <TransformsTab />;
    default: return null;
  }
}

function PreviewSubTab() {
  const result = useAppStore((s) => s.processingResult);
  const events = result?.events ?? [];
  const originalRaw = result?.originalRaw ?? '';

  const [subTab, setSubTab] = useState<PreviewSubTabId>('raw');
  const [search, setSearch] = useState('');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<Set<string>>(new Set());
  const [selectedModification, setSelectedModification] = useState<Set<string>>(new Set());

  const originalMetadata = useAppStore((s) => s.metadata);

  // Enrich events with original raw + change/drop status
  const enrichedEvents = useMemo(() => {
    const origLines = originalRaw.split('\n');
    return events.map((event): EnrichedEvent => {
      const startIdx = Math.max(0, event.lineNumbers.start - 1);
      const endIdx = event.lineNumbers.end;
      const origSlice = origLines.slice(startIdx, endIdx).join('\n');
      return {
        event,
        originalRaw: origSlice,
        hasChanges: origSlice !== event._raw,
        hasMetadataChanges: hasMetadataDiff(event.metadata, originalMetadata),
        isDropped: event._meta._queue === 'nullQueue',
      };
    });
  }, [events, originalRaw, originalMetadata]);

  // Collect all field names across events
  const allFields = useMemo(() => {
    const fieldSet = new Set<string>();
    for (const { event } of enrichedEvents) {
      for (const key of Object.keys(event.fields)) {
        fieldSet.add(key);
      }
    }
    return Array.from(fieldSet).sort();
  }, [enrichedEvents]);

  // Apply filters
  const filteredEvents = useMemo(() => {
    return enrichedEvents.filter((item) => {
      if (search) {
        const lower = search.toLowerCase();
        if (!item.event._raw.toLowerCase().includes(lower)) return false;
      }
      if (selectedFields.size > 0) {
        const eventFieldKeys = Object.keys(item.event.fields);
        if (!eventFieldKeys.some((k) => selectedFields.has(k))) return false;
      }
      if (selectedStatus.size > 0) {
        if (selectedStatus.has('Dropped') && !selectedStatus.has('Accepted') && !item.isDropped) return false;
        if (selectedStatus.has('Accepted') && !selectedStatus.has('Dropped') && item.isDropped) return false;
      }
      if (selectedModification.size > 0) {
        const wantRaw = selectedModification.has('Raw Modified');
        const wantMeta = selectedModification.has('Metadata Modified');
        const wantUnmodified = selectedModification.has('Unmodified');
        const matchesRaw = item.hasChanges;
        const matchesMeta = item.hasMetadataChanges;
        const matchesUnmodified = !item.hasChanges && !item.hasMetadataChanges;
        const matches = (wantRaw && matchesRaw) || (wantMeta && matchesMeta) || (wantUnmodified && matchesUnmodified);
        if (!matches) return false;
      }
      return true;
    });
  }, [enrichedEvents, search, selectedFields, selectedStatus, selectedModification]);

  const { paginatedItems, currentPage, totalPages, eventsPerPage, totalItems, setCurrentPage, setEventsPerPage } =
    usePagination(filteredEvents);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3">
        <div className="flex gap-1">
          {PREVIEW_SUB_TABS.map((tab) => {
            const isActive = tab.id === subTab;
            return (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className="px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Shared filter bar */}
      <PreviewFilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setCurrentPage(1); }}
        allFields={allFields}
        selectedFields={selectedFields}
        onFieldsChange={(f) => { setSelectedFields(f); setCurrentPage(1); }}
        selectedStatus={selectedStatus}
        onStatusChange={(s) => { setSelectedStatus(s); setCurrentPage(1); }}
        selectedModification={selectedModification}
        onModificationChange={(m) => { setSelectedModification(m); setCurrentPage(1); }}
        filteredCount={filteredEvents.length}
        totalCount={enrichedEvents.length}
      />

      {/* Sub-tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {subTab === 'raw' && <RawTab items={paginatedItems} currentPage={currentPage} eventsPerPage={eventsPerPage} search={search} />}
        {subTab === 'highlighted' && <HighlightedTab items={paginatedItems} allEvents={filteredEvents} currentPage={currentPage} eventsPerPage={eventsPerPage} />}
        {subTab === 'calculated' && <CalculatedFieldsTab items={paginatedItems} allEvents={filteredEvents} currentPage={currentPage} eventsPerPage={eventsPerPage} />}
        {subTab === 'diff' && <DiffTab items={paginatedItems} currentPage={currentPage} eventsPerPage={eventsPerPage} />}
        {subTab === 'timestamp' && <TimestampTab items={paginatedItems} currentPage={currentPage} eventsPerPage={eventsPerPage} />}
      </div>

      {/* Shared pagination */}
      {totalItems > eventsPerPage && (
        <EventPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          eventsPerPage={eventsPerPage}
          onPageChange={setCurrentPage}
          onEventsPerPageChange={setEventsPerPage}
        />
      )}
    </div>
  );
}
