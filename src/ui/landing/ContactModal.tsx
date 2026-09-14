import type { PointerEvent, MouseEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { CONTACT_EMAIL } from './assets';
import type { ContactTopic } from './contactMail';
import { contactMailto, readContactContext } from './contactMail';
import { CloseIcon } from './icons';

interface ContactModalProps {
  open: boolean;
  onClose: () => void;
}

type CopyState = 'idle' | 'copied' | 'selected';

/** How long the Copy button reads COPIED before resetting. */
const COPY_FEEDBACK_MS = 2000;

const OPTIONS: { topic: ContactTopic; mark: string; title: string; body: string }[] = [
  { topic: 'bug', mark: '!', title: 'Report a bug', body: 'Something broke, froze or looked wrong.' },
  { topic: 'feature', mark: '+', title: 'Request a feature', body: 'A new mode, a Pokémon, anything you’d like to see.' },
];

const COPY_STATUS: Record<CopyState, string> = {
  idle: '',
  copied: 'Email address copied.',
  selected: 'Address selected. Press Ctrl+C or ⌘C to copy it.',
};

/** What the nav's CONTACT ME and the footer's Contact me open: two
 * pre-filled email templates (bug report, feature request) and the bare
 * address with a Copy button. A `mailto:` link silently does nothing on a
 * computer with no mail app set up, so the address is always on screen and
 * the modal stays open after an option is clicked.
 *
 * A native `<dialog>` opened with showModal(), so the browser supplies the
 * focus trap, Esc to close, the inert page behind it and the ::backdrop.
 * `open` is mirrored onto the element in an effect, and every way it closes
 * (Esc, the X, a backdrop click) reports back through its close event. */
export function ContactModal({ open, onClose }: ContactModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const addressRef = useRef<HTMLAnchorElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdropRef = useRef(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const titleId = useId();
  const leadId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  const handleClose = () => {
    setCopyState('idle');
    onClose();
    // Browsers are meant to hand focus back to the opener themselves; this
    // covers any that don't.
    openerRef.current?.focus();
  };

  // The panel fills the dialog's box, so only a click on the ::backdrop
  // targets the dialog itself. The press has to start there too, or a text
  // selection dragged out of the panel would close it.
  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressStartedOnBackdropRef.current = event.target === event.currentTarget;
  };
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressStartedOnBackdropRef.current && event.target === event.currentTarget) event.currentTarget.close();
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopyState('copied');
    } catch {
      // No clipboard access (an insecure origin, or permission denied):
      // select the address so Ctrl/⌘+C copies it instead.
      if (addressRef.current) window.getSelection()?.selectAllChildren(addressRef.current);
      setCopyState('selected');
    }
  };

  const context = readContactContext();

  return (
    <dialog
      ref={dialogRef}
      className="lp-modal"
      aria-labelledby={titleId}
      aria-describedby={leadId}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <div className="lp-modal-body">
        <div className="lp-modal-head">
          <h2 id={titleId} className="lp-h2">
            CONTACT ME
          </h2>
          <button type="button" className="lp-modal-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            <CloseIcon />
          </button>
        </div>
        <p id={leadId} className="lp-modal-lead">
          Found a bug or have an idea for the game? Pick one and your email app opens with a short template to fill in.
        </p>
        <ul className="lp-modal-options">
          {OPTIONS.map((option) => (
            <li key={option.topic}>
              <a className="lp-modal-option" href={contactMailto(option.topic, context)}>
                <span className="lp-modal-mark" aria-hidden="true">
                  {option.mark}
                </span>
                <span className="lp-modal-option-text">
                  <span className="lp-modal-option-title">{option.title}</span>
                  <span className="lp-modal-option-body">{option.body}</span>
                </span>
                <span className="lp-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="lp-modal-address">
          <p className="lp-modal-address-label">Nothing opened? Email me directly:</p>
          <div className="lp-modal-address-row">
            <a ref={addressRef} className="lp-modal-email" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <button type="button" className="lp-btn lp-btn-ghost lp-modal-copy" onClick={() => void copyAddress()}>
              {copyState === 'copied' ? 'COPIED' : 'COPY'}
            </button>
          </div>
          <p className="lp-sr-only" role="status">
            {COPY_STATUS[copyState]}
          </p>
        </div>
      </div>
    </dialog>
  );
}
