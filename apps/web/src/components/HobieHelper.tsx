import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type HobieContext = 'default' | 'import' | 'calendar' | 'unit' | 'lesson';

const helperCopy: Record<HobieContext, { title: string; body: string }> = {
  default: {
    title: 'Hobie is here to help.',
    body: 'If you are finding your way around, start with the setup guide.'
  },
  import: {
    title: 'Hobie can walk you through the import.',
    body: 'Paste the schedule or choose a clear file. You can review every detail before you save it.'
  },
  calendar: {
    title: 'Hobie can help with the calendar.',
    body: 'Add a file or paste calendar text, then review the dates before they become part of your school year.'
  },
  unit: {
    title: 'Hobie can sketch a unit plan.',
    body: 'Give Hobie a learning goal and meeting details. Review the draft before adding it to your timeline.'
  },
  lesson: {
    title: 'Hobie can help shape the lesson.',
    body: 'Open the step drafter for a starting point, then keep only the steps that fit your class.'
  }
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
                <span>Helpful assistant</span>
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
            <strong>{copy.title}</strong>
            <p>{copy.body}</p>
            {context === 'default' ? (
              <Link to="/guide" onClick={() => setOpen(false)}>
                Open setup guide
              </Link>
            ) : null}
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
