import { create } from 'zustand';
import type { editor } from 'monaco-editor';
import type { EventMetadata, OutputTabId, ProcessingResult, ValidationDiagnostic } from '../engine/types';

interface AppState {
  rawData: string;
  setRawData: (data: string) => void;

  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;

  metadata: EventMetadata;
  setMetadataField: (field: keyof EventMetadata, value: string) => void;
  setMetadata: (meta: EventMetadata) => void;

  propsConf: string;
  setPropsConf: (text: string) => void;

  transformsConf: string;
  setTransformsConf: (text: string) => void;

  processingResult: ProcessingResult | null;
  setProcessingResult: (result: ProcessingResult | null) => void;

  validationDiagnostics: ValidationDiagnostic[];
  setValidationDiagnostics: (diags: ValidationDiagnostic[]) => void;

  theme: 'light' | 'dark';
  toggleTheme: () => void;

  activeOutputTab: OutputTabId;
  setActiveOutputTab: (tab: OutputTabId) => void;

  currentPage: number;
  setCurrentPage: (page: number) => void;

  eventsPerPage: number;
  setEventsPerPage: (count: number) => void;

  collapsedPanels: Record<string, boolean>;
  togglePanelCollapse: (panelId: string) => void;

  helpOpen: boolean;
  toggleHelp: () => void;

  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;

  lastProcessingMs: number | null;
  setLastProcessingMs: (ms: number | null) => void;

  settings: { perEventPipeline: boolean; manualApply: boolean };
  togglePerEventPipeline: () => void;
  toggleManualApply: () => void;

  pipelineDirty: boolean;
  setPipelineDirty: (v: boolean) => void;

  manualRunTick: number;
  triggerManualRun: () => void;

  settingsOpen: boolean;
  toggleSettings: () => void;

  editorInstances: Record<string, editor.IStandaloneCodeEditor>;
  registerEditor: (file: string, instance: editor.IStandaloneCodeEditor) => void;
}

export const useAppStore = create<AppState>((set) => ({
  rawData: '',
  setRawData: (data) => set({ rawData: data, currentPage: 1 }),

  isProcessing: false,
  setIsProcessing: (v) => set({ isProcessing: v }),

  metadata: {
    index: 'main',
    host: '',
    source: '',
    sourcetype: '',
  },
  setMetadataField: (field, value) =>
    set((state) => ({
      metadata: { ...state.metadata, [field]: value },
    })),
  setMetadata: (meta) => set({ metadata: meta }),

  propsConf: '',
  setPropsConf: (text) => set({ propsConf: text }),

  transformsConf: '',
  setTransformsConf: (text) => set({ transformsConf: text }),

  processingResult: null,
  setProcessingResult: (result) => set({ processingResult: result }),

  validationDiagnostics: [],
  setValidationDiagnostics: (diags) => set({ validationDiagnostics: diags }),

  theme: 'dark',
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),

  activeOutputTab: 'preview',
  setActiveOutputTab: (tab) => set({ activeOutputTab: tab }),

  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),

  eventsPerPage: 10,
  setEventsPerPage: (count) => set({ eventsPerPage: count, currentPage: 1 }),

  collapsedPanels: {},
  togglePanelCollapse: (panelId) =>
    set((state) => ({
      collapsedPanels: {
        ...state.collapsedPanels,
        [panelId]: !state.collapsedPanels[panelId],
      },
    })),

  helpOpen: false,
  toggleHelp: () => set((state) => ({ helpOpen: !state.helpOpen })),

  commandPaletteOpen: false,
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  lastProcessingMs: null,
  setLastProcessingMs: (ms) => set({ lastProcessingMs: ms }),

  settings: (() => {
    try {
      const saved = localStorage.getItem('splunk-toolkit:settings');
      if (saved) return JSON.parse(saved) as { perEventPipeline: boolean; manualApply: boolean };
    } catch { /* ignore */ }
    return { perEventPipeline: false, manualApply: false };
  })(),
  togglePerEventPipeline: () =>
    set((state) => {
      const perEventPipeline = !state.settings.perEventPipeline;
      const manualApply = perEventPipeline ? true : state.settings.manualApply;
      const next = { ...state.settings, perEventPipeline, manualApply };
      try { localStorage.setItem('splunk-toolkit:settings', JSON.stringify(next)); } catch { /* ignore */ }
      return { settings: next };
    }),
  toggleManualApply: () =>
    set((state) => {
      const next = { ...state.settings, manualApply: !state.settings.manualApply };
      try { localStorage.setItem('splunk-toolkit:settings', JSON.stringify(next)); } catch { /* ignore */ }
      return { settings: next };
    }),

  pipelineDirty: false,
  setPipelineDirty: (v) => set({ pipelineDirty: v }),

  manualRunTick: 0,
  triggerManualRun: () => set((state) => ({ manualRunTick: state.manualRunTick + 1, pipelineDirty: false })),

  settingsOpen: false,
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  editorInstances: {},
  registerEditor: (file, instance) =>
    set((state) => ({
      editorInstances: { ...state.editorInstances, [file]: instance },
    })),
}));
