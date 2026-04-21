// Runs for every vitest file. Engine tests use the `node` env and skip the
// jsdom-specific setup; component tests opt into jsdom via a
// `// @vitest-environment jsdom` pragma and pick up the DOM bits here.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { afterEach } = await import('vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());

  // jsdom doesn't implement ResizeObserver; react-resizable-panels needs it.
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock;
  }
}
