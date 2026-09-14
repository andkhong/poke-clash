import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL } from './assets';
import type { ContactContext } from './contactMail';
import { contactMailto, mailtoUrl } from './contactMail';

const context: ContactContext = {
  pageUrl: 'https://pokebets.fly.dev/#/',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  viewport: '390×844',
};

function parseMailto(url: string): { address: string; subject: string; body: string } {
  expect(url.startsWith('mailto:')).toBe(true);
  const [address, query] = url.slice('mailto:'.length).split('?');
  const params = new Map(
    query.split('&').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, decodeURIComponent(value)] as const;
    })
  );
  return { address, subject: params.get('subject') ?? '', body: params.get('body') ?? '' };
}

describe('mailtoUrl', () => {
  it('addresses the contact inbox and round-trips reserved characters', () => {
    const url = mailtoUrl('Hi & bye? #1', 'line one\nline two = 50%');
    expect(url).not.toMatch(/[\s+]/);
    expect(parseMailto(url)).toEqual({ address: CONTACT_EMAIL, subject: 'Hi & bye? #1', body: 'line one\r\nline two = 50%' });
  });
});

describe('contactMailto', () => {
  it('gives a bug report the page, browser and screen size', () => {
    const { subject, body } = parseMailto(contactMailto('bug', context));
    expect(subject).toBe('Bug report: PokéBets Arena');
    expect(body).toContain(`Page: ${context.pageUrl}`);
    expect(body).toContain(`Browser: ${context.userAgent}`);
    expect(body).toContain(`Screen: ${context.viewport}`);
  });

  it('leaves device details out of a feature request', () => {
    const { subject, body } = parseMailto(contactMailto('feature', context));
    expect(subject).toBe('Feature request: PokéBets Arena');
    expect(body).toContain('What would you like to see?');
    expect(body).not.toContain(context.userAgent);
  });
});
