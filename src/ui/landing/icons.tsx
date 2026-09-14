/** The landing page's icons, as inline SVG rather than emoji: iOS
 * renders ▶ and ♥ as color emoji glyphs, which ignore `color` and break the
 * button's ink. Decorative only — every control they sit in has its own text
 * label or aria-label — so they're hidden from assistive tech and never take focus. */

export function PlayIcon() {
  return (
    <svg width={12} height={14} viewBox="0 0 12 14" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M0 0L12 7L0 14Z" />
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg width={14} height={11} viewBox="0 0 14 11" fill="currentColor" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d="M0 0H14V11H0ZM1.5 2.2V9.5H12.5V2.2L7 6.3ZM2.6 1.5L7 4.8L11.4 1.5Z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M2.1 0.7L6 4.6L9.9 0.7L11.3 2.1L7.4 6L11.3 9.9L9.9 11.3L6 7.4L2.1 11.3L0.7 9.9L4.6 6L0.7 2.1Z" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6 11L1.2 6.3A2.9 2.9 0 0 1 6 2.4a2.9 2.9 0 0 1 4.8 3.9Z" />
    </svg>
  );
}
