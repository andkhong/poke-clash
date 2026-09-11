import { useEffect, useState } from 'react';

function readInset(): number {
  if (typeof window === 'undefined') return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)));
}

/**
 * How many CSS px of the layout viewport's bottom edge the on-screen keyboard
 * currently covers — 0 while it's closed, and always 0 where visualViewport
 * is unsupported (desktop browsers have no keyboard to cover anything).
 *
 * The match screen is a `100dvh; overflow: hidden` page, which mobile
 * browsers deliberately don't resize for the keyboard (iOS Safari pans the
 * visual viewport instead), so a bottom-anchored drawer holding a text input
 * has to lift itself by this much or its input lands under the keys. The
 * alternative, `interactive-widget=resizes-content` in the viewport meta, is
 * rejected on purpose: shrinking the page would make Phaser FIT-rescale the
 * whole arena every time the keyboard opened.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(readInset);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setInset(readInset());
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
