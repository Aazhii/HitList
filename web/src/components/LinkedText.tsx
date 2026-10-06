import { Fragment, type ReactNode } from 'react';
import { findInlineLinks } from '@/lib/inlineMarkdown';

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={href}
      className="text-a-accent-600 underline underline-offset-2 [overflow-wrap:anywhere] hover:text-a-accent-700 focus-visible:outline focus-visible:outline-2"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}>
      {children}
    </a>
  );
}

export function LinkedText({ text }: { text: string }) {
  const links = findInlineLinks(text);
  return <>{links.map((link, index) => {
    const before = text.slice(index > 0 ? links[index - 1].end : 0, link.start);
    return <Fragment key={link.start}>{before}<TextLink href={link.href}>{link.text}</TextLink></Fragment>;
  })}{text.slice(links.at(-1)?.end ?? 0)}</>;
}