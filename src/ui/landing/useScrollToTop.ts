import { useCallback } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';

/** A "back to top" handler for the landing page's brand link and footer
 * button — smooth-scrolls, except for viewers who asked the OS for reduced
 * motion, who get an instant jump instead. */
export function useScrollToTop(): () => void {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [reduceMotion]);
}
