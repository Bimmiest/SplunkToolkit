interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

const variantColorMap: Record<NonNullable<ProgressBarProps['variant']>, string> = {
  default: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
};

export function ProgressBar({ value, label, variant = 'default' }: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const barColor = variantColorMap[variant];

  return (
    <div className="w-full">
      {(label || true) && (
        <div className="flex items-center justify-between mb-1">
          {label && (
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {label}
            </span>
          )}
          <span
            className="text-xs font-mono ml-auto"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {Math.round(clampedValue)}%
          </span>
        </div>
      )}
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${clampedValue}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
    </div>
  );
}
