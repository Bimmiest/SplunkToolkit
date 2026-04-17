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

  editorInstances: {},
  registerEditor: (file, instance) =>
    set((state) => ({
      editorInstances: { ...state.editorInstances, [file]: instance },
    })),
}));
