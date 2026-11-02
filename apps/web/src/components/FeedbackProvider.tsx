import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren
} from 'react';
import { toCanvas } from 'html-to-image';
import { Link, useLocation } from 'react-router-dom';
import { useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';
import { feedbackCategories, type FeedbackCategory } from '../lib/feedbackTypes.js';
import {
  getFeedbackContext,
  clearFeedbackDiagnostics,
  snapshotFeedbackDiagnostics,
  recordFeedbackEvent
} from '../lib/feedbackDiagnostics.js';
import { FeedbackImageEditor, normalizeFeedbackImage } from './FeedbackImageEditor.js';
import './Feedback.css';

type Launch = { description?: string; category?: FeedbackCategory };
const FeedbackContext = createContext<(options?: Launch) => void>(() => undefined);
export const useOpenFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: PropsWithChildren) {
  const api = useApiClient();
  const auth = useAppAuth();
  const currentLocation = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const reportId = useRef(crypto.randomUUID());
  const capturedContext = useRef<ReturnType<typeof getFeedbackContext> | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState('');
  const [diagnostics, setDiagnostics] = useState(true);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<Record<string, unknown> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [attachmentWarning, setAttachmentWarning] = useState('');

  useLayoutEffect(() => {
    clearFeedbackDiagnostics();
  }, [auth.userId]);

  useEffect(() => {
    recordFeedbackEvent('navigation', {
      component: currentLocation.pathname.split('/')[1] ?? 'home'
    });
  }, [currentLocation.pathname]);

  const launch = (options?: Launch) => {
    if (!auth.isSignedIn) return;
    returnFocus.current = document.activeElement as HTMLElement;
    capturedContext.current = getFeedbackContext();
    setReference('');
    setAttachmentWarning('');
    if (options?.category) setCategory(options.category);
    if (options?.description) setDescription(options.description);
    recordFeedbackEvent('feedback_opened');
    setOpen(true);
  };
  useEffect(() => {
    const handler = (event: Event) => launch((event as CustomEvent<Launch>).detail);
    window.addEventListener('teacheros:feedback', handler);
    return () => window.removeEventListener('teacheros:feedback', handler);
  });
  useEffect(() => {
    const el = dialog.current;
    if (open && !selecting && !capturing) {
      if (!el?.open) el?.showModal();
    } else el?.close();
  }, [open, selecting, capturing]);
  useEffect(() => {
    setOpen(false);
    setDescription('');
    setExpected('');
    setSteps('');
    setScreenshot(null);
    setEditingImage(null);
    setReference('');
    setSelectedElement(null);
    reportId.current = crypto.randomUUID();
  }, [auth.userId]);
  const close = () => {
    setOpen(false);
    returnFocus.current?.focus();
  };
  useEffect(() => {
    if (!selecting) return;
    const move = (event: PointerEvent) => {
      const el = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(
          'button,a,input,select,textarea,[data-feedback-id],[data-feedback-component],[data-testid],main,section'
        );
      setHighlight(el?.getBoundingClientRect() ?? null);
    };
    const select = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const el = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(
          'button,a,input,select,textarea,[data-feedback-id],[data-feedback-component],[data-testid],main,section'
        );
      if (el && !el.closest('[data-feedback-selection]')) {
        const bounds = el.getBoundingClientRect();
        setSelectedElement({
          componentId:
            el.getAttribute('data-feedback-id') ??
            el.getAttribute('data-feedback-component') ??
            undefined,
          testId: el.getAttribute('data-testid') ?? undefined,
          tagName: el.tagName.toLowerCase(),
          parentComponentId:
            el.parentElement?.closest('[data-feedback-id]')?.getAttribute('data-feedback-id') ??
            undefined,
          bounds: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
          },
          pagePath: window.location.pathname
        });
      }
      setSelecting(false);
      setHighlight(null);
    };
    const cancel = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setSelecting(false);
        setHighlight(null);
      }
    };
    const suppress = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', suppress, true);
    document.addEventListener('pointerup', suppress, true);
    document.addEventListener('click', select, true);
    document.addEventListener('keydown', cancel, true);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', suppress, true);
      document.removeEventListener('pointerup', suppress, true);
      document.removeEventListener('click', select, true);
      document.removeEventListener('keydown', cancel, true);
    };
  }, [selecting]);

  const capture = async () => {
    setError('');
    setCapturing(true);
    document.body.classList.add('feedback-capture-mask');
    dialog.current?.close();
    let captureTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await Promise.race([
        toCanvas(document.body, {
          width: window.innerWidth,
          height: window.innerHeight,
          canvasWidth: window.innerWidth,
          canvasHeight: window.innerHeight,
          pixelRatio: 1,
          skipFonts: true,
          backgroundColor: '#f7f7f5',
          filter: (node) => !(node instanceof HTMLElement && node.matches('dialog,.hobie-helper'))
        }),
        new Promise<never>((_, reject) => {
          captureTimeout = setTimeout(() => reject(new Error('Capture timed out')), 8000);
        })
      ]);
      setEditingImage(canvas.toDataURL('image/png'));
    } catch {
      setError('Screenshot capture is unavailable on this page. You can upload an image instead.');
    } finally {
      clearTimeout(captureTimeout);
      document.body.classList.remove('feedback-capture-mask');
      setCapturing(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !category || !description.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const location = capturedContext.current ?? getFeedbackContext();
      let snapshot: ReturnType<typeof snapshotFeedbackDiagnostics> | undefined;
      try {
        if (diagnostics) snapshot = snapshotFeedbackDiagnostics();
      } catch {
        /* Written feedback can be submitted without optional browser metadata. */
      }
      const result = await api.feedbackRequest<{
        id: string;
        referenceNumber: string;
        attachmentWarning?: string;
      }>('/v1/feedback', {
        method: 'POST',
        body: JSON.stringify({
          clientReportId: reportId.current,
          clientSessionId: snapshot?.clientSessionId,
          category,
          description: description.trim(),
          expectedBehavior: expected.trim() || undefined,
          reproductionSteps: category === 'bug' ? steps.trim() || undefined : undefined,
          pagePath: location.pagePath,
          pageName: location.pageName,
          sanitizedUrl: location.sanitizedUrl,
          context: diagnostics
            ? { ...location.context, ...(selectedElement ? { selectedElement } : {}) }
            : selectedElement
              ? { selectedElement }
              : {},
          diagnostics: snapshot ?? {},
          ...(screenshot ? { attachment: { dataUrl: screenshot } } : {})
        })
      });
      setReference(result.referenceNumber);
      setAttachmentWarning(result.attachmentWarning ?? '');
      setDescription('');
      setExpected('');
      setSteps('');
      setScreenshot(null);
      setSelectedElement(null);
      reportId.current = crypto.randomUUID();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Feedback could not be sent. Your text is still here. Please try again.'
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <FeedbackContext.Provider value={launch}>
      {children}
      {selecting && (
        <>
          <div className="feedback-select-hint" data-feedback-selection>
            Click the problem area. Press Escape to cancel.
          </div>
          {highlight && (
            <div
              className="feedback-selection"
              style={{
                left: highlight.x,
                top: highlight.y,
                width: highlight.width,
                height: highlight.height
              }}
            />
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby="feedback-title"
        onCancel={(event) => {
          event.preventDefault();
          if (editingImage) setEditingImage(null);
          else close();
        }}
      >
        <header className="feedback-heading">
          <h2 id="feedback-title">Send Feedback</h2>
          <button className="secondary" type="button" onClick={close}>
            Close
          </button>
        </header>
        {reference ? (
          <div role="status">
            <p>
              Feedback sent. Thank you for helping improve TeacherOS. Reference:{' '}
              <strong>{reference}</strong>.
            </p>
            {attachmentWarning && <p role="alert">{attachmentWarning}</p>}
            <div className="feedback-actions">
              <Link to="/feedback" onClick={close}>
                View my feedback
              </Link>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setReference('');
                  setCategory('');
                  setAttachmentWarning('');
                }}
              >
                Send another report
              </button>
            </div>
          </div>
        ) : editingImage ? (
          <FeedbackImageEditor
            source={editingImage}
            onSave={(image) => {
              setScreenshot(image);
              setEditingImage(null);
            }}
            onCancel={() => setEditingImage(null)}
          />
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p>
              Tell us what happened. We&apos;ll automatically include information about this page to
              help investigate.
            </p>
            <label>
              Feedback category
              <select
                required
                value={category}
                onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {Object.entries(feedbackCategories).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What happened?
              <textarea
                required
                maxLength={10000}
                rows={4}
                placeholder="Describe what happened or what you were trying to do."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              What did you expect? <small>(optional)</small>
              <textarea
                maxLength={5000}
                rows={2}
                placeholder="What were you expecting to happen?"
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
              />
            </label>
            {category === 'bug' && (
              <details>
                <summary>Steps to reproduce (optional)</summary>
                <label>
                  Steps
                  <textarea
                    maxLength={5000}
                    rows={2}
                    value={steps}
                    onChange={(event) => setSteps(event.target.value)}
                    placeholder="1. I opened Year Plan. 2. I tried dragging a lesson. 3. The lesson wouldn't move."
                  />
                </label>
              </details>
            )}
            <div className="feedback-actions">
              <button className="secondary" type="button" onClick={() => void capture()}>
                Capture screenshot
              </button>
              <label className="feedback-upload">
                Upload image
                <input
                  aria-label="Upload screenshot"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void normalizeFeedbackImage(file)
                        .then(setEditingImage)
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : 'Could not open image.')
                        );
                    event.target.value = '';
                  }}
                />
              </label>
              <button className="secondary" type="button" onClick={() => setSelecting(true)}>
                Point to the problem
              </button>
            </div>
            {screenshot && (
              <div>
                <img
                  className="feedback-preview"
                  src={screenshot}
                  alt="Reviewed screenshot attached to feedback"
                />
                <div className="feedback-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setEditingImage(screenshot)}
                  >
                    Edit screenshot
                  </button>
                  <button className="secondary" type="button" onClick={() => setScreenshot(null)}>
                    Remove screenshot
                  </button>
                </div>
              </div>
            )}
            {selectedElement && (
              <p>
                Problem area selected:{' '}
                {String(
                  selectedElement.componentId ?? selectedElement.testId ?? selectedElement.tagName
                )}
                .{' '}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedElement(null)}
                >
                  Remove selection
                </button>
              </p>
            )}
            <label className="feedback-checkbox">
              <input
                type="checkbox"
                checked={diagnostics}
                onChange={(event) => setDiagnostics(event.target.checked)}
              />
              Include technical diagnostics
            </label>
            <p className="muted">
              Includes browser information, page context, recent actions, and safe error details.
              Screenshots are attached only after you review them and send feedback. Please do not
              include student names, grades, or private notes.
            </p>
            {error && (
              <p role="alert" className="notice error">
                {error} Your entered feedback has been preserved.
              </p>
            )}
            <div className="feedback-actions">
              <button type="submit" disabled={busy || !category || !description.trim()}>
                {busy ? 'Sending feedback…' : 'Send Feedback'}
              </button>
              <Link to="/feedback" onClick={close}>
                My feedback
              </Link>
            </div>
          </form>
        )}
      </dialog>
    </FeedbackContext.Provider>
  );
}
