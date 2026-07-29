// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

const SETTINGS_KEY = 'splunk-toolkit:settings';
const initial = useAppStore.getState();

describe('settings — per-event mode implies manual apply (#27)', () => {
  beforeEach(() => {
    useAppStore.setState(initial, true);
    localStorage.clear();
  });

  it('turning per-event mode on forces manual apply on', () => {
    useAppStore.getState().togglePerEventPipeline();
    const { perEventPipeline, manualApply } = useAppStore.getState().settings;
    expect(perEventPipeline).toBe(true);
    expect(manualApply).toBe(true);
  });

  it('manual apply cannot be turned off while per-event mode is on', () => {
    useAppStore.getState().togglePerEventPipeline();
    useAppStore.getState().toggleManualApply();
    expect(useAppStore.getState().settings.manualApply).toBe(true);
  });

  it('leaves persisted state consistent with live state', () => {
    useAppStore.getState().togglePerEventPipeline();
    useAppStore.getState().toggleManualApply();
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(saved.manualApply).toBe(true);
    expect(saved.perEventPipeline).toBe(true);
  });

  it('manual apply toggles freely when per-event mode is off', () => {
    useAppStore.getState().toggleManualApply();
    expect(useAppStore.getState().settings.manualApply).toBe(true);
    useAppStore.getState().toggleManualApply();
    expect(useAppStore.getState().settings.manualApply).toBe(false);
  });
});
