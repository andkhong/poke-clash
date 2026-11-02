import { intl } from '../../i18n';
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
      intl.formatMessage({
        id: 'landing.mail.bug.subject',
        defaultMessage: 'Bug report: Pokémon Brawl',
      }),
      [
        intl.formatMessage({
          id: 'landing.mail.bug.what',
          defaultMessage: 'What happened?',
        }),
        '',
        '',
        intl.formatMessage({
          id: 'landing.mail.bug.expected',
          defaultMessage: 'What did you expect to happen?',
        }),
        '',
        '',
        intl.formatMessage({
          id: 'landing.mail.bug.steps',
          defaultMessage: 'Steps to make it happen again (if you know them):',
        }),
        '',
        '',
        '---',
        intl.formatMessage({
          id: 'landing.mail.bug.details',
          defaultMessage: 'Details to help track it down (delete anything you’d rather not share):',
        }),
        intl.formatMessage({ id: 'landing.mail.bug.page', defaultMessage: 'Page: {value}' }, { value: context.pageUrl }),
        intl.formatMessage(
          {
            id: 'landing.mail.bug.browser',
            defaultMessage: 'Browser: {value}',
          },
          { value: context.userAgent }
        ),
        intl.formatMessage({ id: 'landing.mail.bug.screen', defaultMessage: 'Screen: {value}' }, { value: context.viewport }),
      ].join('\n')
    );
  }
  return mailtoUrl(
    intl.formatMessage({
      id: 'landing.mail.feature.subject',
      defaultMessage: 'Feature request: Pokémon Brawl',
    }),
    [
      intl.formatMessage({
        id: 'landing.mail.feature.what',
        defaultMessage: 'What would you like to see?',
      }),
      '',
      '',
      intl.formatMessage({
        id: 'landing.mail.feature.why',
        defaultMessage: 'How would it make the game more fun for you?',
      }),
      '',
      '',
    ].join('\n')
  );
}
