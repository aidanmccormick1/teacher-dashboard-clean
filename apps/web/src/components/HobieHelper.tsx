import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOpenFeedback } from './FeedbackProvider.js';
import { useHobieIsDrafting } from '../lib/hobieDrafting.js';
import './HobieDrafting.css';

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

export function HobieDraftingIllustration() {
  return (
    <div className="hobie-drafting" aria-hidden="true">
      <svg
        className="hobie-drafting-paper"
        width="150"
        height="112"
        viewBox="0 0 150 112"
        fill="none"
      >
        <path d="M20 7h90l17 18v79H20z" fill="#fffdf7" stroke="#9caea2" />
        <path d="M110 7v18h17" stroke="#9caea2" />
        <path d="M34 29h49" stroke="#29445a" strokeWidth="3" strokeLinecap="round" />
        <g stroke="#789087" strokeWidth="2" strokeLinecap="round">
          <path className="hobie-drafting-line" d="M34 45h66" />
          <path className="hobie-drafting-line" d="M34 58h55" />
          <path className="hobie-drafting-line" d="M34 71h64" />
        </g>
      </svg>
      <img
        className="hobie-drafting-mascot"
        src="/teacherdesk-favicon.png"
        width="66"
        height="66"
        alt=""
      />
      <svg className="hobie-drafting-pencil" width="42" height="42" viewBox="0 0 42 42" fill="none">
        <path
          d="m8 33 3-11L29 4l8 8-18 18-11 3Z"
          fill="#d9ae5f"
          stroke="#29445a"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="m11 22 8 8M26 7l8 8M8 33l5-1-4-4-1 5Z" fill="#29445a" stroke="#29445a" />
      </svg>
    </div>
  );
}

export function HobieHelper({ context = 'default' }: { context?: HobieContext }) {
  const openFeedback = useOpenFeedback();
  const drafting = useHobieIsDrafting();
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
    <div className="hobie-helper" data-drafting={drafting || undefined}>
      {drafting && (
        <>
          <span className="hobie-drafting-status" role="status">
            Hobie is drafting.
          </span>
          {!open ? <HobieDraftingIllustration /> : null}
        </>
      )}
      {open ? (
        <section
          className="hobie-helper-popover"
          id="hobie-helper-popover"
          role="dialog"
          aria-label="Hobie help"
        >
          <header>
            <div className="hobie-helper-identity">
              {!drafting || open ? (
                <img src="/teacherdesk-favicon.png" alt="" aria-hidden="true" />
              ) : null}
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
