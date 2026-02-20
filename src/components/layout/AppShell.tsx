import { Panel, Group, Separator } from 'react-resizable-panels';
import { Header } from './Header';
import { RawPanel } from '../raw/RawPanel';
import { PropsConfEditor } from '../editor/PropsConfEditor';
import { TransformsConfEditor } from '../editor/TransformsConfEditor';
import { PreviewPanel } from '../preview/PreviewPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { useProcessingPipeline } from '../../hooks/useProcessingPipeline';
import { useAppStore } from '../../store/useAppStore';

function ResizeHandle({ direction = 'vertical' }: { direction?: 'horizontal' | 'vertical' }) {
  return (
    <Separator
      className={`
        group relative flex items-center justify-center
        ${direction === 'vertical' ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'}
        bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors
      `}
    >
      <div
        className={`
          rounded-full bg-[var(--color-text-muted)] group-hover:bg-white transition-colors
          ${direction === 'vertical' ? 'h-0.5 w-8' : 'w-0.5 h-8'}
        `}
      />
    </Separator>
  );
}

export function AppShell() {
  useProcessingPipeline();

  const propsCollapsed = useAppStore((s) => !!s.collapsedPanels['props.conf']);
  const transformsCollapsed = useAppStore((s) => !!s.collapsedPanels['transforms.conf']);

  // Build the resizable panel group key based on which panels are expanded
  // This forces a clean re-mount when collapse state changes
  const layoutKey = `${propsCollapsed ? 'pc' : 'pe'}-${transformsCollapsed ? 'tc' : 'te'}`;

  return (
    <div className="h-full flex flex-col">
      <Header />
      <main id="main-content" className="flex-1 min-h-0">
        <Group orientation="horizontal" id="main-horizontal">
          {/* Left side: Raw, Props, Transforms */}
          <Panel defaultSize={38} minSize={20} id="left-inputs">
            <div className="h-full flex flex-col">
              {/* Resizable area for expanded panels */}
              <div className="flex-1 min-h-0">
                <Group orientation="vertical" id={`left-vertical-${layoutKey}`} key={layoutKey}>
                  <Panel defaultSize={propsCollapsed && transformsCollapsed ? 100 : propsCollapsed || transformsCollapsed ? 50 : 30} minSize={10} id="raw-panel">
                    <ErrorBoundary panelName="Raw Data">
                      <RawPanel />
                    </ErrorBoundary>
                  </Panel>
                  {!propsCollapsed && (
                    <>
                      <ResizeHandle direction="vertical" />
                      <Panel defaultSize={38} minSize={10} id="props-editor">
                        <ErrorBoundary panelName="props.conf Editor">
                          <PropsConfEditor />
                        </ErrorBoundary>
                      </Panel>
                    </>
                  )}
                  {!transformsCollapsed && (
                    <>
                      <ResizeHandle direction="vertical" />
                      <Panel defaultSize={32} minSize={10} id="transforms-editor">
                        <ErrorBoundary panelName="transforms.conf Editor">
                          <TransformsConfEditor />
                        </ErrorBoundary>
                      </Panel>
                    </>
                  )}
                </Group>
              </div>
              {/* Collapsed panels render as fixed-height bars at the bottom */}
              {propsCollapsed && (
                <ErrorBoundary panelName="props.conf Editor">
                  <PropsConfEditor />
                </ErrorBoundary>
              )}
              {transformsCollapsed && (
                <ErrorBoundary panelName="transforms.conf Editor">
                  <TransformsConfEditor />
                </ErrorBoundary>
              )}
            </div>
          </Panel>

          <ResizeHandle direction="horizontal" />

          {/* Right side: Output (Preview + CIM + Fields + Transforms + Validation + Architecture) */}
          <Panel defaultSize={62} minSize={30} id="output-panel">
            <ErrorBoundary panelName="Output">
              <PreviewPanel />
            </ErrorBoundary>
          </Panel>
        </Group>
      </main>
    </div>
  );
}
