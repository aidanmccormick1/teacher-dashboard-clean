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
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);
  return (
    <div className="rich-field-wrap">
      <div className="rich-toolbar">
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
      </div>
      <div
        ref={ref}
        className="rich-field"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
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
  useEffect(() => {
    void api
      .getLessonWorkspace(lessonId)
      .then((loaded) => {
        const draft = localStorage.getItem(draftKey(lessonId));
        const restored = draft ? (JSON.parse(draft) as Workspace) : loaded;
        latest.current = restored;
        setData(restored);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this lesson.'));
  }, [api, lessonId]);
  const queue = (next: Workspace, delay = 650) => {
    latest.current = next;
    setData(next);
    localStorage.setItem(draftKey(lessonId), JSON.stringify(next));
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveChain.current = saveChain.current.then(() => save(next));
    }, delay);
  };
  const save = async (next: Workspace) => {
    const revision = ++pending.current;
    try {
      await api.updateLesson(next.lesson.id, {
        title: next.lesson.title,
        description: next.lesson.description,
        lessonPlan: next.lesson.lessonPlan,
        estimatedDurationMinutes: next.lesson.estimatedDurationMinutes
      });
      for (const [index, step] of next.lesson.segments.entries())
        await api.updateSegment(step.id, {
          title: step.title,
          description: step.description,
          durationMinutes: step.durationMinutes,
          stepType: step.stepType ?? null,
          orderIndex: index
        });
      if (revision === pending.current) {
        localStorage.removeItem(draftKey(lessonId));
        setStatus('saved');
      }
    } catch {
      if (revision === pending.current) setStatus('error');
    }
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (latest.current) saveChain.current = saveChain.current.then(() => save(latest.current!));
      }
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
  const addStep = async () => {
    try {
      const detail = await api.createSegment(data.lesson.id, {
        title: 'New step',
        description: null,
        durationMinutes: null,
        stepType: null
      });
      const unit = detail.course.units.find((u) => u.id === data.unit.id)!;
      updateLesson({ segments: unit.lessons.find((l) => l.id === data.lesson.id)!.segments });
    } catch {
      setStatus('error');
    }
  };
  const duplicate = async (step: Step) => {
    try {
      const detail = await api.createSegment(data.lesson.id, {
        title: `${step.title} copy`,
        description: step.description,
        durationMinutes: step.durationMinutes,
        stepType: step.stepType ?? null
      });
      const unit = detail.course.units.find((u) => u.id === data.unit.id)!;
      updateLesson({ segments: unit.lessons.find((l) => l.id === data.lesson.id)!.segments });
    } catch {
      setStatus('error');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this step?')) return;
    try {
      await api.deleteSegment(id);
      updateLesson({ segments: data.lesson.segments.filter((s) => s.id !== id) });
    } catch {
      setStatus('error');
    }
  };
  const share = async (enabled: boolean) => {
    const response = await api.updateLessonShare(data.lesson.id, enabled);
    setData({ ...data, share: response });
    if (response.enabled && response.token)
      await navigator.clipboard?.writeText(`${location.origin}/shared/lessons/${response.token}`);
  };
  return (
    <main className="lesson-workspace">
      <header className="lesson-workspace-header">
        <div>
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
          <button className="secondary" type="button" onClick={() => void share(true)}>
            Share
          </button>
          <Link className="button-link secondary" to={yearPlanReturn}>
            Back to Year Plan
          </Link>
        </div>
      </header>
      <section className="lesson-document">
        <div className="share-state">
          {data.share.enabled ? (
            <>
              <span>Anyone with link · read-only</span>
              <button type="button" className="button-link" onClick={() => void share(false)}>
                Make private
              </button>
            </>
          ) : (
            <>
              <span>Private · only you</span>
            </>
          )}
        </div>
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
        <h2>Lesson</h2>
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
        <button className="add-step" type="button" onClick={() => void addStep()}>
          + Add step
        </button>
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
