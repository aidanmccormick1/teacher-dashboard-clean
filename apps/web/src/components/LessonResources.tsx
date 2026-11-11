import { useEffect, useRef, useState } from 'react';
import type {
  LessonResource,
  LessonResourceKind,
  LessonResourceDocument,
  LessonResourceQuestion,
  LessonWorkspaceResponse,
  PublicLessonResource
} from '@teacheros/contracts';
import { ApiError, publicResourcePdfUrl, useApiClient } from '../lib/api.js';
import './LessonResources.css';

type Step = LessonWorkspaceResponse['lesson']['segments'][number];
const labels: Record<LessonResourceKind, string> = {
  quiz: 'Quiz',
  worksheet: 'Worksheet',
  video: 'Video'
};
const errorText = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Something went wrong. Please retry.';

export function suggestedResourceKind(
  step: Pick<Step, 'title' | 'description' | 'stepType'>
): LessonResourceKind {
  const purpose = `${step.stepType ?? ''} ${step.title}`.toLowerCase();
  if (/quiz|assess|exit ticket|check (?:for )?understanding|test\b|review/.test(purpose))
    return 'quiz';
  if (/worksheet|practice|activity|discussion|problem.solv|group work/.test(purpose))
    return 'worksheet';
  const text = `${step.stepType ?? ''} ${step.title} ${step.description ?? ''}`.toLowerCase();
  if (/quiz|assess|exit ticket|check for understanding|test\b|review/.test(text)) return 'quiz';
  if (/video|watch|introduc|instruction|explain|demonstrat|mini.lesson/.test(text)) return 'video';
  return 'worksheet';
}

export function LessonResourceEditor({
  resource,
  onUpdate,
  onClose
}: {
  resource: LessonResource;
  onUpdate: (resource: LessonResource) => void;
  onClose: () => void;
}) {
  const api = useApiClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState(resource);
  const [document, setDocument] = useState<LessonResourceDocument>(resource.document!);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState('');
  const [change, setChange] = useState<Record<number, string>>({});
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const update = (next: LessonResourceDocument) => {
    setDocument(next);
    setDirty(true);
    setError('');
  };
  const question = (index: number, patch: Partial<LessonResourceQuestion>) =>
    update({
      ...document,
      questions: document.questions.map((item, i) => (i === index ? { ...item, ...patch } : item))
    });
  const accept = (next: LessonResource) => {
    setCurrent(next);
    setDocument(next.document!);
    setDirty(false);
    onUpdate(next);
  };
  const save = async () => {
    if (!dirty) return current;
    const normalized = {
      ...document,
      questions: document.questions.map((item) => ({
        ...item,
        options: item.options.map((option) => option.trim()).filter(Boolean)
      }))
    };
    const next = await api.updateLessonResource(
      current.lessonId,
      current.id,
      current.revision,
      normalized
    );
    accept(next);
    return next;
  };
  const perform = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const close = () =>
    void perform(async () => {
      await save();
      dialog.current?.close();
      onClose();
    });
  const download = (answers: boolean) =>
    void perform(async () => {
      const saved = await save();
      const blob = await api.downloadLessonResource(saved.lessonId, saved.id, answers);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${document.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || current.kind}${answers ? '-answers' : ''}.pdf`;
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <dialog
      ref={dialog}
      className="lesson-resource-dialog"
      aria-labelledby="resource-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="resource-editor-header">
        <div>
          <h2 id="resource-editor-title">{labels[current.kind]}</h2>
          <span role="status">
            {busy ? 'Saving…' : dirty ? 'Unsaved edits' : 'Saved to resources'}
          </span>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={close}>
          Done
        </button>
      </header>
      {error ? (
        <p className="notice warning" role="alert">
          {error}
        </p>
      ) : null}
      <fieldset className="resource-editor-fields" disabled={busy}>
        <div className="resource-document-paper">
          <p className="resource-document-kind">{labels[current.kind]}</p>
          <label className="resource-title-label">
            <span>Title</span>
            <input
              value={document.title}
              maxLength={240}
              onChange={(event) => update({ ...document, title: event.target.value })}
            />
          </label>
          <div className="resource-student-line" aria-hidden="true">
            <span>Name _______________________</span>
            <span>Date ______________</span>
          </div>
          <label>
            <span>Instructions</span>
            <textarea
              aria-label="Instructions"
              value={document.instructions}
              maxLength={3000}
              onChange={(event) => update({ ...document, instructions: event.target.value })}
            />
          </label>
          <ol className="resource-question-list">
            {document.questions.map((item, index) => (
              <li key={index}>
                <label>
                  <span>Question {index + 1}</span>
                  <textarea
                    aria-label={`Question ${index + 1}`}
                    value={item.prompt}
                    maxLength={2400}
                    onChange={(event) => question(index, { prompt: event.target.value })}
                  />
                </label>
                <label>
                  <span>Choices · one per line</span>
                  <textarea
                    aria-label={`Question ${index + 1} choices`}
                    rows={Math.max(2, item.options.length)}
                    value={item.options.join('\n')}
                    onChange={(event) =>
                      question(index, { options: event.target.value.split('\n').slice(0, 6) })
                    }
                  />
                </label>
                <div className="resource-question-settings">
                  <label>
                    <span>Points</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={item.points}
                      onChange={(event) =>
                        question(index, {
                          points: Math.max(0, Math.min(100, Number(event.target.value)))
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Answer lines</span>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      value={item.answerLines}
                      onChange={(event) =>
                        question(index, {
                          answerLines: Math.max(0, Math.min(12, Number(event.target.value)))
                        })
                      }
                    />
                  </label>
                  <button
                    className="button-link danger"
                    type="button"
                    disabled={document.questions.length <= 1}
                    onClick={() =>
                      update({
                        ...document,
                        questions: document.questions.filter((_, i) => i !== index)
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <details className="resource-answer-key">
                  <summary>Answer key</summary>
                  <label>
                    <span>Answer</span>
                    <textarea
                      aria-label={`Question ${index + 1} answer`}
                      value={item.answer}
                      maxLength={2400}
                      onChange={(event) => question(index, { answer: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Explanation</span>
                    <textarea
                      aria-label={`Question ${index + 1} explanation`}
                      value={item.explanation}
                      maxLength={2400}
                      onChange={(event) => question(index, { explanation: event.target.value })}
                    />
                  </label>
                </details>
                <details className="resource-revise">
                  <summary>Revise with Hobie</summary>
                  <label>
                    <span>Change this question</span>
                    <input
                      value={change[index] ?? ''}
                      maxLength={1000}
                      placeholder="Make it easier…"
                      onChange={(event) => setChange({ ...change, [index]: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={(change[index] ?? '').trim().length < 3}
                    onClick={() =>
                      void perform(async () => {
                        const saved = await save();
                        const revised = await api.reviseLessonResourceQuestion(
                          saved.lessonId,
                          saved.id,
                          {
                            expectedRevision: saved.revision,
                            questionIndex: index,
                            instruction: change[index]!
                          }
                        );
                        accept(revised);
                        setChange({ ...change, [index]: '' });
                      })
                    }
                  >
                    Rewrite question
                  </button>
                </details>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="secondary"
            disabled={document.questions.length >= 20}
            onClick={() =>
              update({
                ...document,
                questions: [
                  ...document.questions,
                  {
                    prompt: 'New question',
                    options: [],
                    answer: '',
                    explanation: '',
                    points: 1,
                    answerLines: 3
                  }
                ]
              })
            }
          >
            Add question
          </button>
        </div>
      </fieldset>
      <footer className="resource-editor-footer">
        {dirty && error ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Discard your unsaved edits?')) {
                dialog.current?.close();
                onClose();
              }
            }}
          >
            Discard edits
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={busy || !dirty}
          onClick={() =>
            void perform(async () => {
              await save();
            })
          }
        >
          Save
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => download(true)}>
          Answer key PDF
        </button>
        <button type="button" disabled={busy} onClick={() => download(false)}>
          Download PDF
        </button>
      </footer>
    </dialog>
  );
}

export function LessonResourceOpenButton({
  resource,
  onUpdate,
  primary = false
}: {
  resource: LessonResource;
  onUpdate: (resource: LessonResource) => void;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const api = useApiClient();
  const [current, setCurrent] = useState(resource);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const refreshAndOpen = async () => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      const { resources } = await api.getLessonResources(resource.lessonId);
      const latest = resources.find(
        (item) => item.id === resource.id && item.status === 'ready' && item.document
      );
      if (!latest) throw new Error('This document is unavailable. Reload the lesson.');
      setCurrent(latest);
      onUpdate(latest);
      setOpen(true);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setOpening(false);
    }
  };
  if (resource.status !== 'ready') return null;
  if (resource.video)
    return (
      <a
        className={`button-link ${primary ? 'lesson-resource-primary' : 'secondary'}`}
        href={resource.video.url}
        target="_blank"
        rel="noreferrer"
      >
        Open video
      </a>
    );
  if (!resource.document) return null;
  return (
    <>
      <button
        className={primary ? 'lesson-resource-primary' : 'secondary'}
        type="button"
        disabled={opening}
        onClick={() => void refreshAndOpen()}
      >
        {opening ? 'Opening…' : `Open ${resource.kind}`}
      </button>
      {open ? (
        <LessonResourceEditor
          resource={current}
          onUpdate={onUpdate}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {error ? (
        <span className="resource-tool-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

export function LessonResourceTools({
  lessonId,
  step,
  resources,
  prepare,
  onUpdate,
  disabled
}: {
  lessonId: string;
  step: Step;
  resources: LessonResource[];
  prepare: () => Promise<void>;
  onUpdate: (resource: LessonResource) => void;
  disabled: boolean;
}) {
  const api = useApiClient();
  const [choice, setChoice] = useState<LessonResourceKind | null>(null);
  const kind =
    choice ??
    resources.find((item) => item.segmentId === step.id && item.status === 'ready')?.kind ??
    suggestedResourceKind(step);
  const resource = resources.find((item) => item.segmentId === step.id && item.kind === kind);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<LessonResource | null>(null);
  const stale =
    resource?.status === 'generating' && Date.now() - Date.parse(resource.updatedAt) > 120_000;
  useEffect(() => {
    if (!resource || resource.status !== 'generating' || busy) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api
        .getLessonResources(lessonId)
        .then(({ resources }) => {
          const updated = resources.find((item) => item.id === resource.id);
          if (active && updated) onUpdate(updated);
        })
        .catch(() => {
          if (active) setError('Could not check this resource. Reopen the lesson to retry.');
        });
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, resource?.id, resource?.status, busy, lessonId, onUpdate]);
  const creating = busy || (resource?.status === 'generating' && !stale);
  const generate = async () => {
    if (working.current || creating || disabled) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await prepare();
      const result = await api.generateLessonResource(lessonId, {
        segmentId: step.id,
        kind,
        instruction
      });
      onUpdate(result);
      if (result.document && result.status === 'ready') setOpened(result);
    } catch (error) {
      setError(errorText(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <aside className="lesson-step-resource-tools" aria-label={`Resources for ${step.title}`}>
      {resource?.status === 'ready' ? (
        <LessonResourceOpenButton resource={resource} onUpdate={onUpdate} primary />
      ) : (
        <button
          type="button"
          className="lesson-resource-primary"
          disabled={disabled || creating}
          onClick={() => void generate()}
        >
          {creating
            ? kind === 'video'
              ? 'Finding video…'
              : 'Creating…'
            : kind === 'video'
              ? 'Find video'
              : `Create ${kind}`}
        </button>
      )}
      <label className="lesson-resource-kind">
        <span className="visually-hidden">Resource type for {step.title}</span>
        <select
          value={kind}
          disabled={creating}
          onChange={(event) => {
            setChoice(event.target.value as LessonResourceKind);
            setError('');
          }}
        >
          <option value="quiz">Quiz</option>
          <option value="worksheet">Worksheet</option>
          <option value="video">Video</option>
        </select>
      </label>
      {resource?.status !== 'ready' && !creating ? (
        <details className="lesson-resource-options">
          <summary>Options</summary>
          <label>
            <span>{kind === 'video' ? 'Video preferences' : 'Instructions'}</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={
                kind === 'video' ? 'Under 5 minutes…' : 'Five questions, mixed difficulty…'
              }
            />
          </label>
        </details>
      ) : null}
      {creating ? (
        <span role="status" className="resource-tool-status">
          {kind === 'video' ? 'Searching' : 'Hobie is drafting'}
        </span>
      ) : null}
      {resource?.status === 'ready' ? (
        <span className="resource-tool-status">Saved to resources</span>
      ) : null}
      {error || resource?.status === 'failed' ? (
        <p className="resource-tool-error" role="alert">
          {error || resource?.error || 'Could not create this resource. Retry above.'}
        </p>
      ) : null}
      {opened ? (
        <LessonResourceEditor
          resource={opened}
          onUpdate={(resource) => {
            setOpened(resource);
            onUpdate(resource);
          }}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </aside>
  );
}

export function LessonResourceLibrary({
  resources,
  onUpdate
}: {
  resources: LessonResource[];
  onUpdate: (resource: LessonResource) => void;
}) {
  const ready = resources.filter((resource) => resource.status === 'ready');
  if (!ready.length) return null;
  return (
    <ul className="lesson-generated-resources">
      {ready.map((resource) => (
        <li key={resource.id}>
          <div>
            <strong>{resource.document?.title ?? resource.video?.title}</strong>
            <span>
              {labels[resource.kind]}
              {resource.video ? ` · ${resource.video.source}` : ''}
            </span>
          </div>
          <LessonResourceOpenButton resource={resource} onUpdate={onUpdate} />
        </li>
      ))}
    </ul>
  );
}

export function SharedLessonResources({
  resources,
  token,
  scope = 'lessons'
}: {
  resources: PublicLessonResource[];
  token: string;
  scope?: 'lessons' | 'curriculum';
}) {
  if (!resources.length) return null;
  return (
    <ul className="shared-generated-resources">
      {resources.map((resource) => (
        <li key={resource.id}>
          <div>
            <strong>{resource.document?.title ?? resource.video?.title}</strong>
            {resource.video ? <p>{resource.video.description}</p> : null}
          </div>
          <a
            className="button-link secondary"
            href={resource.video?.url ?? publicResourcePdfUrl(token, resource.id, scope)}
            target={resource.video ? '_blank' : undefined}
            rel={resource.video ? 'noreferrer' : undefined}
          >
            {resource.video ? 'Open video' : 'Download PDF'}
          </a>
        </li>
      ))}
    </ul>
  );
}
