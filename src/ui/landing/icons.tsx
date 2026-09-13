/** The landing page's only two icons, as inline SVG rather than emoji: iOS
 * renders ▶ and ♥ as color emoji glyphs, which ignore `color` and break the
 * button's ink. Decorative only — every button they sit in has its own text
 * label — so they're hidden from assistive tech and never take focus. */

export function PlayIcon() {
  return (
    <svg width={12} height={14} viewBox="0 0 12 14" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M0 0L12 7L0 14Z" />
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
