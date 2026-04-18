import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Tabs } from '../ui/Tabs';
import { Icon } from '../ui/Icon';
import type { EventMetadata, OutputTabId, PreviewSubTabId, SplunkEvent } from '../../engine/types';
import { SAMPLE_CONFIGS } from '../../engine/sampleData';
import { RawTab } from './tabs/RawTab';
import { HighlightedTab } from './tabs/HighlightedTab';
import { DiffTab } from './tabs/DiffTab';
import { CalculatedFieldsTab } from './tabs/CalculatedFieldsTab';
import { TimestampTab } from './tabs/TimestampTab';
import { RegexTab } from './tabs/RegexTab';
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
  { id: 'highlighted', label: 'Extractions' },
  { id: 'timestamp', label: 'Timestamp' },
  { id: 'calculated', label: 'Calc Fields' },
  { id: 'diff', label: 'Diff' },
  { id: 'regex', label: 'Regex' },
];

export function PreviewPanel() {
  const activeTab = useAppStore((s) => s.activeOutputTab);
  const setActiveTab = useAppStore((s) => s.setActiveOutputTab);
  const result = useAppStore((s) => s.processingResult);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const tabs = useMemo(() => [
    { id: 'preview', label: 'Preview' },
    { id: 'cim', label: 'CIM Models' },
    { id: 'fields', label: 'Fields' },
    { id: 'transforms', label: 'Pipeline' },
    { id: 'architecture', label: 'Architecture' },
  ], []);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2 px-3">
          <Icon name="eye" className="w-4 h-4 text-[var(--color-accent)]" />
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
        className="flex-1 min-h-0 overflow-auto relative"
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        aria-busy={isProcessing}
      >
        <TabContent tab={activeTab} hasData={!!result && result.events.length > 0} />
        {isProcessing && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ backgroundColor: 'var(--color-bg-primary)', opacity: 0.6 }}
            aria-hidden="true"
          >
            <span className="text-xs text-[var(--color-text-muted)]">Processing…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TabContent({ tab, hasData }: { tab: OutputTabId; hasData: boolean }) {
  if (tab === 'architecture') return <ArchitecturePanel embedded />;

  if (!hasData) {
    return <EmptyState />;
  }

  switch (tab) {
    case 'preview': return <PreviewSubTab />;
    case 'cim': return <CimModelsTab />;
    case 'fields': return <FieldsTab />;
    case 'transforms': return <TransformsTab />;
    default: return null;
  }
}

function EmptyState() {
  const setRawData = useAppStore((s) => s.setRawData);
  const setPropsConf = useAppStore((s) => s.setPropsConf);
  const setTransformsConf = useAppStore((s) => s.setTransformsConf);
  const setMetadata = useAppStore((s) => s.setMetadata);

  const loadExample = (idx: number) => {
    const sample = SAMPLE_CONFIGS[idx];
    setRawData(sample.rawData);
    setPropsConf(sample.propsConf);
    setTransformsConf(sample.transformsConf);
    setMetadata(sample.metadata);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <Icon name="eye" className="w-10 h-10 text-[var(--color-border)]" />
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">No data to preview</p>
        <p className="text-xs text-[var(--color-text-muted)] max-w-xs">
          Paste raw log data in the left panel and add a sourcetype stanza in props.conf to simulate the Splunk processing pipeline.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2 w-full max-w-xs">
        <p className="text-xs font-medium text-[var(--color-text-muted)]">Load an example</p>
        <div className="flex flex-col gap-1.5 w-full">
          {SAMPLE_CONFIGS.map((sample, idx) => (
            <button
              key={sample.name}
              onClick={() => loadExample(idx)}
              className="w-full text-left px-3 py-2 rounded-md text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
            >
              <span className="font-medium block">{sample.name}</span>
              <span className="text-[var(--color-text-muted)]">{sample.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewSubTab() {
  const result = useAppStore((s) => s.processingResult);
  const events = useMemo(() => result?.events ?? [], [result]);
  const originalRaw = result?.originalRaw ?? '';

  const [subTab, setSubTab] = useState<PreviewSubTabId>('raw');
  const [search, setSearch] = useState('');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<Set<string>>(new Set());
  const [selectedChangeState, setSelectedChangeState] = useState<Set<string>>(new Set());

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
      if (selectedChangeState.size > 0) {
        const wantRaw = selectedChangeState.has('Raw Modified');
        const wantMeta = selectedChangeState.has('Metadata Modified');
        const wantUnmodified = selectedChangeState.has('Unmodified');
        const matchesRaw = item.hasChanges;
        const matchesMeta = item.hasMetadataChanges;
        const matchesUnmodified = !item.hasChanges && !item.hasMetadataChanges;
        const matches = (wantRaw && matchesRaw) || (wantMeta && matchesMeta) || (wantUnmodified && matchesUnmodified);
        if (!matches) return false;
      }
      return true;
    });
  }, [enrichedEvents, search, selectedFields, selectedStatus, selectedChangeState]);

  const { paginatedItems, currentPage, totalPages, eventsPerPage, totalItems, setCurrentPage, setEventsPerPage } =
    usePagination(filteredEvents);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar — uses shared Tabs for keyboard nav + ARIA */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2">
        <Tabs
          tabs={PREVIEW_SUB_TABS}
          activeTab={subTab}
          onTabChange={(id) => setSubTab(id as PreviewSubTabId)}
          ariaLabel="Event preview sub-tabs"
          size="sm"
        />
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
        selectedChangeState={selectedChangeState}
        onChangeStateChange={(m) => { setSelectedChangeState(m); setCurrentPage(1); }}
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
        {subTab === 'regex' && <RegexTab items={paginatedItems} currentPage={currentPage} eventsPerPage={eventsPerPage} />}
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
