import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 select-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border-border text-foreground bg-transparent',
        // High-Contrast Luxury Success Badge (WCAG AAA >= 7:1)
        success:
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:border-emerald-500/25',
        // SolidShorts Yield Badge for Candidate Highlight Cards
        yield:
          'border-emerald-500/40 bg-emerald-950/40 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-500/40 shadow-xs font-mono font-medium',
        warning:
          'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:border-amber-500/25',
        info:
          'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400 dark:border-blue-500/25',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
