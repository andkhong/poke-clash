import { useCallback } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';

/** Smooth-scrolls to a landing section by element id, or to the top with no
 * id — instantly for viewers who asked the OS for reduced motion. Sections
 * are reached this way rather than with `href="#rooms"`, because the hash is
 * the app's router (`#rooms` would leave the landing route). */
export function useScrollTo(): (id?: string) => void {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return useCallback(
    (id?: string) => {
      const behavior = reduceMotion ? 'auto' : 'smooth';
      if (id) document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' });
      else window.scrollTo({ top: 0, behavior });
    },
    [reduceMotion]
  );
}
