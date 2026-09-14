import { CONTACT_EMAIL } from './assets';

export type ContactTopic = 'bug' | 'feature';

/** What a bug report's template records about the visitor's setup. Passed in
 * rather than read from `window` inside the templates, so they stay pure. */
export interface ContactContext {
  pageUrl: string;
  userAgent: string;
  viewport: string;
}

export function readContactContext(): ContactContext {
  return {
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  };
}

/** A `mailto:` link to the contact inbox with a subject and body filled in.
 * RFC 6068 wants CRLF line breaks, and encodeURIComponent writes spaces as
 * %20 — never `+`, which mail apps would show literally. */
export function mailtoUrl(subject: string, body: string): string {
  const crlfBody = body.replace(/\r?\n/g, '\r\n');
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlfBody)}`;
}

/** The contact modal's two templates. Only the bug report carries the page,
 * browser and screen size, since those are what it takes to reproduce one;
 * the visitor sees all of it in their mail app before anything is sent. */
export function contactMailto(topic: ContactTopic, context: ContactContext): string {
  if (topic === 'bug') {
    return mailtoUrl(
      'Bug report: PokéBets Arena',
      [
        'What happened?',
        '',
        '',
        'What did you expect to happen?',
        '',
        '',
        'Steps to make it happen again (if you know them):',
        '',
        '',
        '---',
        'Details to help track it down (delete anything you’d rather not share):',
        `Page: ${context.pageUrl}`,
        `Browser: ${context.userAgent}`,
        `Screen: ${context.viewport}`,
      ].join('\n')
    );
  }
  return mailtoUrl(
    'Feature request: PokéBets Arena',
    ['What would you like to see?', '', '', 'How would it make the game more fun for you?', '', ''].join('\n')
  );
}
