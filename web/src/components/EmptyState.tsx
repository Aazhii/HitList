import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The design system's EmptyState — showcase 176, 180, 306, 594, 597, 792, 898.
 *
 * Every empty and error state in the design pairs a line-art illustration with
 * a title and a sentence that says what to do next. The illustrations ship in
 * `web/public/ill/` (copied from the design bundle's `hl/ill/`); `ILL` below is
 * the whole set, so a caller names one rather than typing a path.
 *
 * The DS is explicit that personality here comes from the illustration, not
 * from emoji or exclamation marks — keep the copy warm but directive.
 */
export const ILL = {
  noData: 'no_data.png',
  noFilteredData: 'no_filtered_data.png',
  noSearchResult: 'no_search_result.png',
  sampleData: 'sample_data.png',
  errorState: 'error_state.png',
  schedule: 'schedule.png',
  template: 'template.png',
  discussion: 'discussion.png',
  deleteConfirmation: 'delete_confirmation.png',
  securityPrivacy: 'security_privacy.png',
  happyMascot: 'happy_mascot.png',
  botMascot: 'bot_mascot.png',
} as const;

export type IllustrationName = (typeof ILL)[keyof typeof ILL];

interface EmptyStateProps {
  /** One of `ILL`. */
  image: IllustrationName;
  title: string;
  description?: ReactNode;
  /** A single primary action, rendered under the description. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ image, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('mx-auto flex max-w-[520px] flex-col items-center gap-4 py-12 text-center animate-fade-in', className)}>
      <img src={`/ill/${image}`} alt="" aria-hidden className="h-[132px] w-auto select-none" draggable={false} />
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[16px] font-semibold text-a-ink">{title}</h3>
        {description && (
          <p className="text-[14px] leading-relaxed text-a-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
