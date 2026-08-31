import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { LessonWorkspaceResponse } from '@teacheros/contracts';
import { ApiError, useApiClient } from '../lib/api.js';

type Workspace = LessonWorkspaceResponse;
type Step = Workspace['lesson']['segments'][number];
const types = [
  'Warm-up',
  'Instruction',
  'Discussion',
  'Activity',
  'Practice',
  'Review',
  'Assessment',
  'Exit Ticket',
  'Custom'
];
const draftKey = (id: string) => `teacherdesk_lesson_workspace_${id}`;
const rich = (value: string | null) => value ?? '';

function RichField({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);
  return (
    <div className="rich-field-wrap">
      {active ? (
        <div className="rich-toolbar" aria-label="Formatting">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('bold');
            }}
          >
            B
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('italic');
            }}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('insertUnorderedList');
            }}
          >
            • List
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('insertOrderedList');
            }}
          >
            1. List
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('formatBlock', false, 'h3');
            }}
          >
            Heading
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              const href = window.prompt('Link URL (https://)');
              if (href && /^https?:\/\//i.test(href))
                document.execCommand('createLink', false, href);
            }}
          >
            Link
          </button>
        </div>
      ) : null}
      <div
        ref={ref}
        className="rich-field"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  );
}

export function LessonWorkspacePage() {
  const api = useApiClient();
  const { lessonId = '' } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const pending = useRef(0);
  const timer = useRef<number | null>(null);
  const latest = useRef<Workspace | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [dragged, setDragged] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generatedSteps, setGeneratedSteps] = useState<Array<{
    title: string;
    description: string;
    durationMinutes: number;
  }> | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const draftVersion = useRef(0);
  const retryTimer = useRef<number | null>(null);
  useEffect(() => {
    void api
      .getLessonWorkspace(lessonId)
      .then((loaded) => {
        const draft = localStorage.getItem(draftKey(lessonId));
        let restored = loaded;
        try {
          restored = draft ? (JSON.parse(draft) as Workspace) : loaded;
        } catch {
          localStorage.removeItem(draftKey(lessonId));
        }
        latest.current = restored;
        setData(restored);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this lesson.'));
  }, [api, lessonId]);
  const queue = (next: Workspace, delay = 650) => {
    const version = ++draftVersion.current;
    latest.current = next;
    setData(next);
    localStorage.setItem(draftKey(lessonId), JSON.stringify(next));
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveChain.current = saveChain.current.then(() => save(next, version));
    }, delay);
  };
  const save = async (next: Workspace, version = draftVersion.current) => {
    const revision = ++pending.current;
    try {
      await api.updateLesson(next.lesson.id, {
        title: next.lesson.title,
        description: next.lesson.description,
        lessonPlan: next.lesson.lessonPlan,
        estimatedDurationMinutes: next.lesson.estimatedDurationMinutes
      });
      for (const step of next.lesson.segments)
        await api.updateSegment(step.id, {
          title: step.title,
          description: step.description,
          durationMinutes: step.durationMinutes,
          stepType: step.stepType ?? null,
          orderIndex: step.orderIndex
        });
      await api.reorderSegments(next.lesson.id, {
        segmentIds: next.lesson.segments.map((step) => step.id)
      });
      if (revision === pending.current && version === draftVersion.current) {
        localStorage.removeItem(draftKey(lessonId));
        setStatus('saved');
      }
    } catch {
      if (revision === pending.current && version === draftVersion.current) {
        setStatus('error');
        // Keep the local draft and retry the exact latest revision once the
        // connection recovers. New typing supersedes this retry naturally.
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          if (latest.current && version === draftVersion.current) {
            saveChain.current = saveChain.current.then(() => save(latest.current!, version));
          }
        }, 1_500);
      }
    }
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (latest.current)
          saveChain.current = saveChain.current.then(() =>
            save(latest.current!, draftVersion.current)
          );
      }
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    []
  );
  if (error) return <p className="notice warning">{error}</p>;
  if (!data) return <p className="muted">Loading lesson…</p>;
  const returnTo = params.get('returnTo');
  const yearPlanReturn = returnTo?.startsWith('/year-plan')
    ? returnTo
    : `/year-plan?course=${data.course.id}`;
  const updateLesson = (patch: Partial<Workspace['lesson']>) =>
    queue({ ...data, lesson: { ...data.lesson, ...patch } });
  const updateStep = (id: string, patch: Partial<Step>) =>
    updateLesson({
      segments: data.lesson.segments.map((s) => (s.id === id ? { ...s, ...patch } : s))
    });
  const queueServerMutation = <T,>(mutation: () => Promise<T>) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      const snapshot = latest.current;
      const version = draftVersion.current;
      if (snapshot) saveChain.current = saveChain.current.then(() => save(snapshot, version));
    }
    const request = saveChain.current.then(mutation);
    // Keep the queue usable after a failed create/delete while still returning
    // the original rejection to the button action.
    saveChain.current = request.then(
      () => undefined,
      () => undefined
    );
    return request;
  };
  const replaceSegmentsFromDetail = (detail: Awaited<ReturnType<typeof api.createSegment>>) => {
    const unit = detail.course.units.find((item) => item.id === data.unit.id);
    const lesson = unit?.lessons.find((item) => item.id === data.lesson.id);
    if (!lesson || !latest.current) return;
    const locallyEdited = new Map(latest.current.lesson.segments.map((step) => [step.id, step]));
    queue(
      {
        ...latest.current,
        lesson: {
          ...latest.current.lesson,
          segments: lesson.segments.map((step) => ({ ...step, ...locallyEdited.get(step.id) }))
        }
      },
      0
    );
  };
  const addStep = async () => {
    try {
      const detail = await queueServerMutation(() =>
        api.createSegment(data.lesson.id, {
          title: 'New step',
          description: null,
          durationMinutes: null,
          stepType: null
        })
      );
      replaceSegmentsFromDetail(detail);
    } catch {
      setStatus('error');
    }
  };
  const duplicate = async (step: Step) => {
    try {
      const detail = await queueServerMutation(() =>
        api.createSegment(data.lesson.id, {
          title: `${step.title} copy`,
          description: step.description,
          durationMinutes: step.durationMinutes,
          stepType: step.stepType ?? null
        })
      );
      replaceSegmentsFromDetail(detail);
    } catch {
      setStatus('error');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this step?')) return;
    try {
      await queueServerMutation(() => api.deleteSegment(id));
      if (latest.current) {
        queue(
          {
            ...latest.current,
            lesson: {
              ...latest.current.lesson,
              segments: latest.current.lesson.segments.filter((step) => step.id !== id)
            }
          },
          0
        );
      }
    } catch {
      setStatus('error');
    }
  };
  const share = async (enabled: boolean) => {
    try {
      const response = await api.updateLessonShare(
        latest.current?.lesson.id ?? data.lesson.id,
        enabled
      );
      if (latest.current) {
        const next = { ...latest.current, share: response };
        latest.current = next;
        setData(next);
        localStorage.setItem(draftKey(lessonId), JSON.stringify(next));
      }
    } catch {
      setStatus('error');
    }
  };
  const generateStepDraft = async () => {
    try {
      setGenerationError(null);
      const draft = await api.generateSegments({
        lessonTitle: data.lesson.title,
        objective: data.lesson.lessonPlan.objective,
        durationMinutes: data.lesson.estimatedDurationMinutes ?? 45
      });
      setGeneratedSteps(draft.segments);
    } catch (err) {
      setGenerationError(
        err instanceof ApiError ? err.message : 'Could not generate a lesson draft.'
      );
    }
  };
  const acceptGeneratedSteps = async () => {
    if (!generatedSteps?.length) return;
    try {
      setStatus('saving');
      await queueServerMutation(async () => {
        for (const step of generatedSteps) {
          await api.createSegment(data.lesson.id, {
            title: step.title,
            description: step.description,
            durationMinutes: step.durationMinutes,
            stepType: null
          });
        }
      });
      const refreshed = await queueServerMutation(() => api.getLessonWorkspace(data.lesson.id));
      const local = latest.current;
      if (local) {
        const serverById = new Map(refreshed.lesson.segments.map((step) => [step.id, step]));
        const retained = local.lesson.segments
          .filter((step) => serverById.has(step.id))
          .map((step) => ({ ...serverById.get(step.id)!, ...step }));
        const retainedIds = new Set(retained.map((step) => step.id));
        queue(
          {
            ...refreshed,
            lesson: {
              ...refreshed.lesson,
              title: local.lesson.title,
              description: local.lesson.description,
              lessonPlan: local.lesson.lessonPlan,
              estimatedDurationMinutes: local.lesson.estimatedDurationMinutes,
              segments: [
                ...retained,
                ...refreshed.lesson.segments.filter((step) => !retainedIds.has(step.id))
              ]
            }
          },
          0
        );
      } else {
        latest.current = refreshed;
        setData(refreshed);
        setStatus('saved');
      }
      setGeneratedSteps(null);
      setGenerationOpen(false);
    } catch (err) {
      setGenerationError(
        err instanceof ApiError ? err.message : 'Could not add the approved steps.'
      );
    }
  };
  return (
    <main className="lesson-workspace lesson-document-page">
      <header className="lesson-workspace-header">
        <div>
          <Link className="lesson-return" to={yearPlanReturn}>
            ← Year Plan
          </Link>
          <p className="eyebrow">
            {data.course.name} / {data.unit.title}
          </p>
          <input
            className="lesson-title-input"
            value={data.lesson.title}
            onChange={(e) => updateLesson({ title: e.target.value })}
          />
        </div>
        <div className="profile-actions">
          <span className={`autosave ${status}`}>
            {status === 'saving'
              ? 'Saving…'
              : status === 'error'
                ? 'Saved locally — retrying'
                : 'Saved'}
          </span>
          <button className="secondary" type="button" onClick={() => setShareOpen((open) => !open)}>
            Share
          </button>
          {data.share.enabled && data.share.token ? (
            <a
              className="button-link secondary"
              href={`/shared/lessons/${data.share.token}`}
              target="_blank"
              rel="noreferrer"
            >
              Preview
            </a>
          ) : null}
        </div>
      </header>
      <section className="lesson-document">
        {shareOpen ? (
          <aside className="lesson-share-popover" aria-label="Share lesson">
            <strong>Share lesson</strong>
            <label>
              <input
                type="radio"
                checked={!data.share.enabled}
                onChange={() => void share(false)}
              />
              Private · only me
            </label>
            <label>
              <input type="radio" checked={data.share.enabled} onChange={() => void share(true)} />
              Anyone with link · read-only
            </label>
            {data.share.enabled && data.share.token ? (
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    `${location.origin}/shared/lessons/${data.share.token}`
                  )
                }
              >
                Copy link
              </button>
            ) : null}
            <button className="button-link" type="button" onClick={() => setShareOpen(false)}>
              Done
            </button>
          </aside>
        ) : null}
        <div className="lesson-meta">
          <input
            type="number"
            min="1"
            value={data.lesson.estimatedDurationMinutes ?? ''}
            onChange={(e) =>
              updateLesson({
                estimatedDurationMinutes: e.target.value ? Number(e.target.value) : null
              })
            }
            placeholder="45"
          />{' '}
          min <span>Lesson {data.lesson.orderIndex + 1}</span>
        </div>
        <label className="workspace-label">
          Objective
          <RichField
            value={rich(data.lesson.lessonPlan.objective)}
            onChange={(objective) =>
              updateLesson({ lessonPlan: { ...data.lesson.lessonPlan, objective } })
            }
            placeholder="What will students be able to do?"
          />
        </label>
        <label className="workspace-label">
          Materials
          <RichField
            value={rich(data.lesson.lessonPlan.materials)}
            onChange={(materials) =>
              updateLesson({ lessonPlan: { ...data.lesson.lessonPlan, materials } })
            }
            placeholder="Worksheets, slides, resources…"
          />
        </label>
        <label className="workspace-label">
          Lesson notes
          <RichField
            value={rich(data.lesson.description)}
            onChange={(description) => updateLesson({ description })}
            placeholder="Add an overview or teacher notes…"
          />
        </label>
        <div className="lesson-steps-heading">
          <h2>Lesson steps</h2>
          <div className="profile-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setGenerationOpen((open) => !open)}
            >
              Generate draft
            </button>
            <button className="add-step" type="button" onClick={() => void addStep()}>
              + Add step
            </button>
          </div>
        </div>
        {generationOpen ? (
          <aside className="lesson-generation-draft">
            <strong>Review-first lesson draft</strong>
            <p>Nothing changes until you explicitly add the proposed steps.</p>
            {!generatedSteps ? (
              <button type="button" onClick={() => void generateStepDraft()}>
                Generate steps
              </button>
            ) : (
              <>
                <ol>
                  {generatedSteps.map((step) => (
                    <li key={`${step.title}-${step.durationMinutes}`}>
                      <strong>{step.title}</strong> · {step.durationMinutes} min
                      <span>{step.description}</span>
                    </li>
                  ))}
                </ol>
                <div className="profile-actions">
                  <button type="button" onClick={() => void acceptGeneratedSteps()}>
                    Add approved steps
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setGeneratedSteps(null)}
                  >
                    Discard draft
                  </button>
                </div>
              </>
            )}
            {generationError ? <p className="notice warning">{generationError}</p> : null}
          </aside>
        ) : null}
        {data.lesson.segments.map((step, index) => (
          <article
            className="lesson-step"
            key={step.id}
            draggable
            onDragStart={() => setDragged(step.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragged || dragged === step.id) return;
              const items = [...data.lesson.segments];
              const from = items.findIndex((s) => s.id === dragged);
              items.splice(index, 0, items.splice(from, 1)[0]!);
              updateLesson({ segments: items });
              setDragged(null);
            }}
          >
            <span className="drag-handle">⠿</span>
            <input
              className="step-minutes"
              type="number"
              min="1"
              value={step.durationMinutes ?? ''}
              onChange={(e) =>
                updateStep(step.id, {
                  durationMinutes: e.target.value ? Number(e.target.value) : null
                })
              }
              placeholder="min"
            />
            <div className="step-main">
              <input
                className="step-title"
                value={step.title}
                onChange={(e) => updateStep(step.id, { title: e.target.value })}
              />
              <select
                value={step.stepType ?? ''}
                onChange={(e) => updateStep(step.id, { stepType: e.target.value || null })}
              >
                <option value="">Type</option>
                {types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <RichField
                value={rich(step.description)}
                onChange={(description) => updateStep(step.id, { description })}
                placeholder="Describe this step…"
              />
            </div>
            <div className="step-actions">
              <button type="button" onClick={() => void duplicate(step)}>
                Duplicate
              </button>
              <button type="button" onClick={() => void remove(step.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
        <aside className="section-context">
          <strong>Sections using this lesson</strong>
          {data.sections.map((section) => (
            <span key={section.id}>
              {section.name} · {section.status?.replaceAll('_', ' ') ?? 'Planned'}
            </span>
          ))}
        </aside>
      </section>
    </main>
  );
}
