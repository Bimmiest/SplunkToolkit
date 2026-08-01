import type React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getStagesForDirective, PHASE_LABELS } from '../../engine/pipelineStages';
import { CopyButton } from '../editor/CopyButton';
import { Icon } from '../ui/Icon';
import { Chip, DirectiveBadges } from './DictionaryBadges';
import type { DictionaryEntry } from './entries';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div
      className="relative rounded-md border overflow-hidden"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-primary)' }}
    >
      <pre className="px-3 py-2 pr-20 text-[11px] font-mono overflow-x-auto text-[var(--color-text-primary)]">
        {code}
      </pre>
      <div className="absolute top-1 right-1">
        <CopyButton getText={() => code} />
      </div>
    </div>
  );
}

function PropertyTable({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
          <dd className="min-w-0 text-[var(--color-text-primary)]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px]">{children}</span>;
}

export function DictionaryDetail({ entry }: { entry: DictionaryEntry }) {
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const helpOpen = useAppStore((s) => s.helpOpen);

  const openPipelineReference = () => {
    if (!helpOpen) toggleHelp();
  };

  if (entry.kind === 'stanza') {
    const { stanza } = entry;
    return (
      <article className="flex flex-col gap-6 px-6 py-5">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold font-mono text-[var(--color-text-primary)]">
            {stanza.label}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <Chip>stanza header</Chip>
            <Chip mono>props.conf</Chip>
          </div>
        </header>

        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {stanza.description}
        </p>

        <Section title="Precedence">
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {stanza.precedence}
          </p>
        </Section>

        {stanza.patternSyntax.length > 0 && (
          <Section title="Pattern syntax">
            <ul className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
              {stanza.patternSyntax.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="text-[var(--color-text-muted)]">
                    •
                  </span>
                  {/* The registry writes these with backtick spans; render the
                      literal text rather than pulling in a Markdown parser for
                      three bullet points. */}
                  <span>{line.replace(/`/g, '')}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Example">
          <CodeBlock code={stanza.example} />
        </Section>
      </article>
    );
  }

  const { info } = entry;
  const stages = getStagesForDirective(info.key);

  return (
    <article className="flex flex-col gap-6 px-6 py-5">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold font-mono text-[var(--color-text-primary)]">
          {info.isClassBased ? `${info.key}-<class>` : info.key}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <DirectiveBadges info={info} />
        </div>
      </header>

      {info.deprecated && (
        <p
          className="flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-relaxed"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: 'var(--color-error)' }}
        >
          <Icon name="warning" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          This directive is deprecated and may be removed in a future Splunk release.
        </p>
      )}

      <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">{info.description}</p>

      <Section title="Example">
        <CodeBlock code={info.example} />
      </Section>

      <Section title="Properties">
        <PropertyTable
          rows={[
            { label: 'Category', value: info.category },
            { label: 'Value type', value: <Mono>{info.valueType}</Mono> },
            { label: 'Default', value: <Mono>{info.defaultValue || '(none)'}</Mono> },
            { label: 'Applies to', value: <Mono>{info.appliesTo}</Mono> },
            ...(info.enumValues && info.enumValues.length > 0
              ? [
                  {
                    label: 'Valid values',
                    value: (
                      <span className="flex flex-wrap gap-1">
                        {info.enumValues.map((v) => (
                          <Chip key={v} mono>
                            {v}
                          </Chip>
                        ))}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>

      {info.isClassBased && (
        <Section title="Class-based directive">
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            This key takes a class name suffix, so one stanza can declare several of them —
            for example <Mono>{info.key}-client_ip</Mono> and <Mono>{info.key}-status</Mono>.
            The suffix names the setting; it is not part of the extracted field name.
          </p>
        </Section>
      )}

      {stages.length > 0 && (
        <Section title="Runs at">
          <div className="flex flex-col gap-1.5">
            {stages.map((stage) => (
              <button
                key={stage.step}
                type="button"
                onClick={openPipelineReference}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-left cursor-pointer transition-colors
                  hover:bg-[var(--color-bg-tertiary)] outline-none focus-visible:ring-2"
                style={{
                  borderColor: 'var(--color-border-subtle)',
                  backgroundColor: 'var(--color-bg-elevated)',
                }}
              >
                <span className="text-xs font-medium text-[var(--color-text-primary)]">
                  {stage.step}. {stage.name}
                </span>
                <Chip tone={stage.phase === 'index-time' ? 'index' : 'search'}>
                  {PHASE_LABELS[stage.phase]}
                </Chip>
                <Icon
                  name="arrow-right"
                  className="ml-auto w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]"
                />
              </button>
            ))}
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Opens the pipeline reference, which shows where this stage sits in the full order.
            </p>
          </div>
        </Section>
      )}
    </article>
  );
}
