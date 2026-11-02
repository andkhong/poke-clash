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

export function CrowdIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M2 20c0-3.3 2.7-5 6-5s6 1.7 6 5M12 20c0-3.3 2.7-5 6-5s4 1 4 3" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" />
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

export function GlobeIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 4l4 4 4-4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 7.5l3.2 3L12 3.5" />
    </svg>
  );
}
