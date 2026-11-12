import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, lessonResources } from '@teacheros/db';
import type { LessonResource } from '@teacheros/contracts';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { publicLessonResource, videoIdentity } from './services/lesson-resources.js';

const headers = {
  'x-dev-user-id': 'resource-teacher',
  'x-dev-user-email': 'resources@example.test'
};
const document = {
  title: 'Ecosystems quiz',
  instructions: 'Answer each question.',
  questions: [
    {
      prompt: 'How do producers get energy?',
      options: ['Sunlight', 'Soil only'],
      answer: 'Sunlight',
      explanation: 'Photosynthesis converts light into chemical energy.',
      points: 2,
      answerLines: 0
    },
    {
      prompt: 'Explain one food-chain relationship.',
      options: [],
      answer: 'A rabbit eats grass.',
      explanation: 'Energy passes from producer to consumer.',
      points: 3,
      answerLines: 3
    }
  ]
};
const response = (value: unknown, sources: string[] = []) =>
  new Response(
    JSON.stringify({
      output: [
        ...(sources.length
          ? [{ type: 'web_search_call', action: { sources: sources.map((url) => ({ url })) } }]
          : []),
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }
      ]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

describe.skipIf(process.env.RUN_INTEGRATION_DB_TESTS !== '1')('lesson resources', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let lessonId: string, segmentId: string, courseId: string, unitId: string;
  const ai = vi.fn<typeof fetch>();
  beforeAll(async () => {
    const directory = new URL('../../../packages/db/migrations/', import.meta.url);
    const existing = await pool.query("SELECT to_regclass('public.lessons') AS lessons");
    const migrations = existing.rows[0]?.lessons
      ? ['0032_lesson_resources.sql']
      : (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of migrations)
      await pool.query(await readFile(new URL(file, directory), 'utf8'));
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users CASCADE');
    app = await createApp({
      ...loadConfig(),
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'resource-test-key',
      FEEDBACK_EMAIL_ENABLED: false
    });
    ai.mockReset().mockResolvedValue(response(document));
    vi.stubGlobal('fetch', ai);
    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/onboarding',
      headers,
      payload: {
        fullName: 'Resource Teacher',
        phone: null,
        workEmail: 'resources@example.test',
        schoolName: 'Resource Test School',
        district: 'Test',
        state: 'CA',
        role: 'teacher',
        subjects: ['Science'],
        grades: ['6']
      }
    });
    expect(onboard.statusCode, onboard.body).toBe(200);
    const course = await app.inject({
      method: 'POST',
      url: '/v1/courses',
      headers,
      payload: { name: 'Science 6', subject: 'Science', gradeLevel: '6' }
    });
    courseId = course.json().course.id;
    const unit = await app.inject({
      method: 'POST',
      url: `/v1/courses/${courseId}/units`,
      headers,
      payload: { title: 'Ecosystems', description: null }
    });
    unitId = unit.json().course.units[0].id;
    const lesson = await app.inject({
      method: 'POST',
      url: `/v1/units/${unitId}/lessons`,
      headers,
      payload: {
        title: 'Food chains',
        description: 'Track energy through an ecosystem.',
        estimatedDurationMinutes: 45
      }
    });
    lessonId = lesson.json().course.units[0].lessons[0].id;
    const segment = await app.inject({
      method: 'POST',
      url: `/v1/lessons/${lessonId}/segments`,
      headers,
      payload: {
        title: 'Check understanding',
        description: 'Identify producers and consumers.',
        durationMinutes: 10
      }
    });
    segmentId = segment.json().course.units[0].lessons[0].segments[0].id;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });
  afterAll(async () => {
    await pool.end();
  });
  const generate = (kind = 'quiz') =>
    app.inject({
      method: 'POST',
      url: `/v1/lessons/${lessonId}/resources`,
      headers,
      payload: { segmentId, kind }
    });

  it('drafts and appends one quiz without rewriting lesson fields, steps, or resources, including retries', async () => {
    const originalResource = (await generate()).json<LessonResource>();
    const before = (
      await app.inject({ method: 'GET', url: `/v1/lessons/${lessonId}/workspace`, headers })
    ).json();
    const addition = {
      title: 'Food chains quiz',
      description: 'Check understanding of producers and consumers.',
      durationMinutes: 5,
      resourceKind: 'quiz',
      document
    };
    ai.mockResolvedValue(response(addition));
    const draft = await app.inject({
      method: 'POST',
      url: `/v1/lessons/${lessonId}/hobie-draft`,
      headers,
      payload: { instruction: 'Add a single quiz.' }
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json()).toMatchObject({ draft: null, question: null, addition });
    expect(JSON.parse(String(ai.mock.calls[1]![1]!.body)).text.format.name).toBe(
      'hobie_lesson_addition'
    );
    const apply = {
      method: 'POST' as const,
      url: `/v1/lessons/${lessonId}/hobie-addition`,
      headers,
      payload: {
        requestId: '3049e810-e881-4dd4-af4d-a4828cce5abd',
        expectedRevision: before.lesson.editRevision,
        addition: draft.json().addition
      }
    };
    const [first, repeated] = await Promise.all([app.inject(apply), app.inject(apply)]);
    expect(first.statusCode, first.body).toBe(200);
    expect(repeated.statusCode, repeated.body).toBe(200);
    const after = first.json();
    const { segments: oldSteps, editRevision: oldRevision, ...oldFields } = before.lesson;
    const { segments: newSteps, editRevision: newRevision, ...newFields } = after.lesson;
    expect(newFields).toEqual(oldFields);
    expect(newSteps.slice(0, oldSteps.length)).toEqual(oldSteps);
    expect(newSteps).toHaveLength(oldSteps.length + 1);
    expect(newSteps.at(-1)).toMatchObject({
      id: apply.payload.requestId,
      title: addition.title,
      stepType: 'Assessment'
    });
    expect(after.resources).toHaveLength(before.resources.length + 1);
    expect(
      after.resources.find((resource: LessonResource) => resource.id === originalResource.id)
    ).toEqual(originalResource);
    expect(
      after.resources.find(
        (resource: LessonResource) => resource.segmentId === apply.payload.requestId
      )
    ).toMatchObject({ kind: 'quiz', status: 'ready', document });
    expect(newRevision).toBeGreaterThan(oldRevision);
    expect((await app.inject(apply)).json().lesson.segments).toHaveLength(newSteps.length);
    const stale = await app.inject({
      ...apply,
      payload: { ...apply.payload, requestId: '12862a03-6597-42b0-a717-b34540b9158a' }
    });
    expect(stale.statusCode).toBe(409);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('keeps clear add requests scoped even in planning mode and reserves full drafts for explicit planning', async () => {
    const addition = {
      title: 'A short quiz',
      description: 'Answer the questions.',
      durationMinutes: 5,
      resourceKind: 'quiz',
      document
    };
    ai.mockResolvedValue(response(addition));
    const request = {
      method: 'POST' as const,
      url: `/v1/lessons/${lessonId}/hobie-draft`,
      headers
    };
    const focused = await app.inject({
      ...request,
      payload: { instruction: 'Add a single quiz.', mode: 'plan' }
    });
    expect(focused.statusCode, focused.body).toBe(200);
    expect(focused.json().draft).toBeNull();
    expect(focused.json().addition.document).toEqual(document);
    const full = {
      question: null,
      draft: {
        title: 'A new lesson',
        description: '',
        objective: 'A new objective',
        studentDirections: '',
        teacherNotes: '',
        materials: '',
        durationMinutes: 45,
        steps: []
      }
    };
    ai.mockResolvedValue(response(full));
    const planning = await app.inject({
      ...request,
      payload: { instruction: 'Plan a complete lesson on ecosystems.', mode: 'plan' }
    });
    expect(planning.statusCode, planning.body).toBe(200);
    expect(planning.json()).toEqual({ ...full, addition: null });
    const unchanged = (
      await app.inject({ method: 'GET', url: `/v1/lessons/${lessonId}/workspace`, headers })
    ).json();
    expect(unchanged.lesson.title).toBe('Food chains');
    expect(unchanged.lesson.segments).toHaveLength(1);
  });

  it('reserves one generation across concurrent clicks and reuses the result after reload', async () => {
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    ai.mockImplementation(async () => {
      await wait;
      return response(document);
    });
    const first = generate();
    const pending = Promise.resolve(first);
    await vi.waitFor(async () => expect((await db.select().from(lessonResources)).length).toBe(1));
    const repeated = await generate();
    expect(repeated.json().status).toBe('generating');
    expect(ai).toHaveBeenCalledTimes(1);
    finish();
    const ready = (await pending).json<LessonResource>();
    expect(ready.status).toBe('ready');
    expect((await generate()).json().id).toBe(ready.id);
    expect(ai).toHaveBeenCalledTimes(1);
    const workspace = await app.inject({
      method: 'GET',
      url: `/v1/lessons/${lessonId}/workspace`,
      headers
    });
    expect(workspace.json().resources).toHaveLength(1);
    expect(JSON.parse(String(ai.mock.calls[0]![1]!.body)).input[1].content).toContain(
      '"gradeLevel":"6"'
    );
  });

  it('edits without AI, rejects stale writes, downloads PDFs, and keeps public resources synced without answers', async () => {
    const created = (await generate()).json<LessonResource>();
    const edited = { ...document, title: 'Revised quiz' };
    const patch = {
      method: 'PATCH' as const,
      url: `/v1/lessons/${lessonId}/resources/${created.id}`,
      headers,
      payload: { expectedRevision: 0, document: edited }
    };
    expect((await app.inject(patch)).json().revision).toBe(1);
    expect((await app.inject(patch)).statusCode).toBe(409);
    expect(ai).toHaveBeenCalledTimes(1);
    const privateUrl = `/v1/lessons/${lessonId}/resources/${created.id}/pdf`;
    expect((await app.inject({ method: 'GET', url: privateUrl })).statusCode).toBe(401);
    const pdf = await app.inject({ method: 'GET', url: privateUrl, headers });
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: privateUrl,
          headers: {
            'x-dev-user-id': 'unrelated-resource-teacher',
            'x-dev-user-email': 'unrelated@example.test'
          }
        })
      ).statusCode
    ).toBe(404);
    const share = await app.inject({
      method: 'PATCH',
      url: `/v1/lessons/${lessonId}/share`,
      headers,
      payload: { enabled: true }
    });
    const token = share.json().token;
    const shared = await app.inject({ method: 'GET', url: `/v1/public/lessons/${token}` });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().resources[0].document.title).toBe('Revised quiz');
    expect(shared.json().resources[0].document.questions[0]).not.toHaveProperty('answer');
    expect(shared.json().resources[0].document.questions[0]).not.toHaveProperty('explanation');
    expect(shared.json().lesson.steps[0].id).toBe(segmentId);
    const publicUrl = `/v1/public/lessons/${token}/resources/${created.id}/pdf?answers=true`;
    expect((await app.inject({ method: 'GET', url: publicUrl })).statusCode).toBe(200);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/lessons/${lessonId}/duplicate`,
      headers
    });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    const copiedId = duplicate
      .json()
      .course.units[0].lessons.find((lesson: { id: string }) => lesson.id !== lessonId).id;
    const copied = (
      await app.inject({ method: 'GET', url: `/v1/lessons/${copiedId}/workspace`, headers })
    ).json();
    expect(copied.resources).toHaveLength(1);
    expect(copied.resources[0].document.questions[0].answer).toBe('Sunlight');
    expect(copied.resources[0].segmentId).toBe(copied.lesson.segments[0].id);
    const imported = await app.inject({
      method: 'POST',
      url: `/v1/public/lessons/${token}/import`,
      headers,
      payload: { courseId, unitId, requestId: 'db2fa710-c8b7-43f2-b31d-538a52cc8f43' }
    });
    expect(imported.statusCode, imported.body).toBe(200);
    const importedWorkspace = (
      await app.inject({
        method: 'GET',
        url: `/v1/lessons/${imported.json().lessonId}/workspace`,
        headers
      })
    ).json();
    expect(importedWorkspace.resources).toHaveLength(1);
    expect(importedWorkspace.resources[0].document.title).toBe('Revised quiz');
    expect(importedWorkspace.resources[0].document.questions[0].answer).toBe('');
    expect(importedWorkspace.resources[0].segmentId).toBe(importedWorkspace.lesson.segments[0].id);
    const courseShare = await app.inject({
      method: 'PATCH',
      url: `/v1/courses/${courseId}/share`,
      headers,
      payload: { enabled: true }
    });
    expect(courseShare.statusCode, courseShare.body).toBe(200);
    const curriculumToken = courseShare.json().token;
    const curriculum = await app.inject({
      method: 'GET',
      url: `/v1/public/curriculum/${curriculumToken}`
    });
    expect(curriculum.statusCode, curriculum.body).toBe(200);
    expect(curriculum.json().course.units[0].lessons[0].resources[0].document.title).toBe(
      'Revised quiz'
    );
    expect(
      curriculum.json().course.units[0].lessons[0].resources[0].document.questions[0]
    ).not.toHaveProperty('answer');
    const curriculumPdf = `/v1/public/curriculum/${curriculumToken}/resources/${created.id}/pdf`;
    expect((await app.inject({ method: 'GET', url: curriculumPdf })).statusCode).toBe(200);
    await app.inject({
      method: 'PATCH',
      url: `/v1/courses/${courseId}/share`,
      headers,
      payload: { enabled: false }
    });
    expect((await app.inject({ method: 'GET', url: curriculumPdf })).statusCode).toBe(404);
    await app.inject({
      method: 'PATCH',
      url: `/v1/lessons/${lessonId}/share`,
      headers,
      payload: { enabled: false }
    });
    expect((await app.inject({ method: 'GET', url: publicUrl })).statusCode).toBe(404);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('rewrites only the requested question and requires the saved revision', async () => {
    const created = (await generate()).json<LessonResource>();
    ai.mockResolvedValue(response({ ...document.questions[0], prompt: 'Name one producer.' }));
    const request = {
      method: 'POST' as const,
      url: `/v1/lessons/${lessonId}/resources/${created.id}/revise`,
      headers,
      payload: { expectedRevision: 0, questionIndex: 0, instruction: 'Make it easier.' }
    };
    const revised = await app.inject(request);
    expect(revised.statusCode, revised.body).toBe(200);
    expect(revised.json().document.questions[0].prompt).toBe('Name one producer.');
    expect(revised.json().document.questions[1]).toEqual(document.questions[1]);
    const prompt = String(ai.mock.calls[1]![1]!.body);
    expect(prompt).not.toContain('Explain one food-chain relationship.');
    expect((await app.inject(request)).statusCode).toBe(409);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('uses quiz setup selections and rejects a document that ignores them', async () => {
    const quizPreferences = {
      focus: 'application',
      format: 'written',
      questionCount: 7,
      difficulty: 'challenge'
    };
    const request = {
      method: 'POST' as const,
      url: `/v1/lessons/${lessonId}/resources`,
      headers,
      payload: { segmentId, kind: 'quiz', quizPreferences }
    };
    const mismatch = await app.inject(request);
    expect(mismatch.statusCode).toBe(502);
    expect(mismatch.json().error).toBe('Hobie could not match those quiz settings. Try again.');
    const questions = Array.from({ length: 7 }, () => ({ ...document.questions[1]!, options: [] }));
    ai.mockResolvedValue(response({ ...document, questions }));
    const matching = await app.inject(request);
    expect(matching.statusCode, matching.body).toBe(200);
    expect(matching.json().document.questions).toHaveLength(7);
    expect(
      matching
        .json()
        .document.questions.every((question: { options: string[] }) => !question.options.length)
    ).toBe(true);
    const prompt = JSON.parse(JSON.parse(String(ai.mock.calls[1]![1]!.body)).input[1].content);
    expect(prompt.quizPreferences).toEqual(quizPreferences);
    expect(prompt.quizRequirements).toContain('without adding untaught content');
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('defaults older quiz setups to lesson-level difficulty and rejects invalid count or difficulty before AI', async () => {
    const request = {
      method: 'POST' as const,
      url: `/v1/lessons/${lessonId}/resources`,
      headers
    };
    for (const quizPreferences of [
      { focus: 'recall', format: 'written', questionCount: 2.5 },
      { focus: 'recall', format: 'written', questionCount: 21 },
      { focus: 'recall', format: 'written', questionCount: 2, difficulty: 'instant' }
    ]) {
      const invalid = await app.inject({
        ...request,
        payload: { segmentId, kind: 'quiz', quizPreferences }
      });
      expect(invalid.statusCode).toBe(400);
    }
    expect(ai).not.toHaveBeenCalled();
    ai.mockResolvedValue(
      response({
        ...document,
        questions: document.questions.map((question) => ({ ...question, options: [] }))
      })
    );
    const legacy = await app.inject({
      ...request,
      payload: {
        segmentId,
        kind: 'quiz',
        quizPreferences: { focus: 'recall', format: 'written', questionCount: 2 }
      }
    });
    expect(legacy.statusCode, legacy.body).toBe(200);
    const prompt = JSON.parse(JSON.parse(String(ai.mock.calls[0]![1]!.body)).input[1].content);
    expect(prompt.quizPreferences.difficulty).toBe('standard');
  });

  it('rejects invented video URLs and permits a retry with a grounded playable video', async () => {
    const video = {
      title: 'Food chains',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      source: 'Education',
      description: 'Explains energy transfer.'
    };
    ai.mockResolvedValue(response({ video }));
    expect((await generate('video')).statusCode).toBe(502);
    ai.mockImplementation(async (url) =>
      String(url).includes('/oembed')
        ? new Response('{}', { status: 200 })
        : response({ video }, [video.url])
    );
    const retry = await generate('video');
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().status).toBe('ready');
    expect(await db.select().from(lessonResources)).toHaveLength(1);
    const request = JSON.parse(
      String(ai.mock.calls.find((call) => String(call[0]).includes('openai'))![1]!.body)
    );
    expect(request.tools).toEqual([{ type: 'web_search' }]);
    expect(request.tool_choice).toBe('required');
    expect(videoIdentity('https://www.youtube.com/results?search_query=ecosystems')).toBeNull();
    expect(videoIdentity('https://khanacademy.org/')).toBeNull();
    expect(publicLessonResource(retry.json()).video?.url).toBe(video.url);
  });
});
