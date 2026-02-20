import type React from 'react';

interface BadgeProps {
  variant: 'error' | 'warning' | 'info' | 'success';
  children: React.ReactNode;
}

const variantStyles: Record<BadgeProps['variant'], { bg: string; text: string }> = {
  error: {
    bg: 'rgba(239, 68, 68, 0.15)',
    text: 'var(--color-error)',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.15)',
    text: 'var(--color-warning)',
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.15)',
    text: 'var(--color-info)',
  },
  success: {
    bg: 'rgba(34, 197, 94, 0.15)',
    text: 'var(--color-success)',
  },
};

export function Badge({ variant, children }: BadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-tight"
      style={{
        backgroundColor: styles.bg,
        color: styles.text,
      }}
    >
      {children}
    </span>
  );
}
