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
  // The showcase wraps the DS EmptyState and its button in a 520px, 16px-gap
  // column with a 48px margin (e.g. line 176); the DS component itself is a
  // 420px, 40/24-padded column with a 180px illustration, an h2 and a 16px body.
  return (
    <div className={cn('mx-auto my-12 flex max-w-[520px] flex-col items-center gap-4 animate-fade-in', className)}>
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 px-6 py-10 text-center">
        <img src={`/ill/${image}`} alt="" aria-hidden className="mb-1 h-auto w-[180px] max-w-[60%] select-none" draggable={false} />
        <h3 className="text-[20px] font-semibold leading-[1.35] text-a-ink">{title}</h3>
        {description && <p className="text-[16px] leading-[1.65] text-a-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
