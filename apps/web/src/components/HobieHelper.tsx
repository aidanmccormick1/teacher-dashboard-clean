import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOpenFeedback } from './FeedbackProvider.js';

export type HobieContext = 'default' | 'import' | 'calendar' | 'unit' | 'lesson';

const helperCopy: Record<HobieContext, string> = {
  default: 'Hobie is here to help.',
  import: 'Hobie can walk you through the import.',
  calendar: 'Hobie can help with the calendar.',
  unit: 'Hobie can sketch a unit plan.',
  lesson: 'Hobie can help shape the lesson.'
};

export function HobieHint({
  children,
  className = ''
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hobie-inline-note${className ? ` ${className}` : ''}`}>
      <img src="/teacherdesk-favicon.png" alt="" aria-hidden="true" />
      <div className="hobie-inline-note-content">{children}</div>
    </div>
  );
}

export function HobieHelper({ context = 'default' }: { context?: HobieContext }) {
  const openFeedback = useOpenFeedback();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = helperCopy[context];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <div className="hobie-helper">
      {open ? (
        <section
          className="hobie-helper-popover"
          id="hobie-helper-popover"
          role="dialog"
          aria-label="Hobie help"
        >
          <header>
            <div className="hobie-helper-identity">
              <img src="/teacherdesk-favicon.png" alt="" aria-hidden="true" />
              <div>
                <strong>Hobie</strong>
              </div>
            </div>
            <button
              ref={closeRef}
              className="hobie-helper-close"
              type="button"
              aria-label="Close Hobie help"
              onClick={() => {
                setOpen(false);
                window.setTimeout(() => triggerRef.current?.focus(), 0);
              }}
            >
              ×
            </button>
          </header>
          <div className="hobie-helper-copy">
            <strong>{copy}</strong>
            {context === 'default' ? (
              <Link to="/guide" onClick={() => setOpen(false)}>
                Open setup guide
              </Link>
            ) : null}
            <button
              className="secondary hobie-feedback-action"
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                openFeedback();
              }}
            >
              Send feedback
            </button>
          </div>
        </section>
      ) : null}
      <button
        ref={triggerRef}
        className="hobie-helper-trigger"
        type="button"
        aria-label="Open Hobie help"
        aria-expanded={open}
        aria-controls="hobie-helper-popover"
        onClick={() => setOpen((value) => !value)}
      >
        <img src="/teacherdesk-favicon.png" alt="" aria-hidden="true" />
        <span className="hobie-helper-question" aria-hidden="true">
          ?
        </span>
      </button>
    </div>
  );
}
