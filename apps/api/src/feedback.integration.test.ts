import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const fakeObjects = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('./lib/s3.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/s3.js')>();
  return {
    ...original,
    createS3Client: () => ({
      destroy() {},
      async send(command: {
        constructor: { name: string };
        input: { Key: string; Body?: Uint8Array };
      }) {
        const key = command.input.Key;
        if (command.constructor.name === 'PutObjectCommand')
          fakeObjects.set(key, command.input.Body!);
        if (command.constructor.name === 'DeleteObjectCommand') fakeObjects.delete(key);
        if (command.constructor.name === 'GetObjectCommand')
          return { Body: { transformToByteArray: async () => fakeObjects.get(key) } };
        return {};
      }
    })
  };
});

const describeDatabase = process.env.RUN_FEEDBACK_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('private feedback API against PostgreSQL', () => {
  let app: FastifyInstance;
  let db: typeof import('@teacheros/db');
  let teacher: Record<string, string>;
  let other: Record<string, string>;
  let owner: Record<string, string>;
  let admin: Record<string, string>;
  const reportBody = () => ({
    clientReportId: randomUUID(),
    category: 'bug',
    description: 'Lesson reorder failed',
    pagePath: '/year-plan',
    pageName: 'Year Plan',
    context: { courseId: randomUUID() },
    diagnostics: {
      events: [
        { type: 'drag_end', timestamp: new Date().toISOString(), metadata: { success: false } }
      ],
      errors: [
        {
          category: 'TypeError',
          message: 'TypeError',
          fingerprint: 'fp-1',
          route: '/year-plan',
          timestamp: new Date().toISOString()
        }
      ]
    }
  });
  const submit = async (headers = teacher, body = reportBody()) =>
    app.inject({ method: 'POST', url: '/v1/feedback', headers, payload: body });
  beforeAll(async () => {
    const { createApp } = await import('./app.js');
    const { loadConfig } = await import('./config.js');
    db = await import('@teacheros/db');
    app = await createApp({
      ...loadConfig(),
      NODE_ENV: 'test',
      FEEDBACK_EMAIL_ENABLED: false,
      FEEDBACK_S3_BUCKET: 'feedback-test'
    });
    await app.ready();
  }, 60000);
  beforeEach(async () => {
    const marker = randomUUID();
    teacher = {
      'x-dev-user-id': `feedback-teacher-${marker}`,
      'x-dev-user-email': `teacher-${marker}@example.com`
    };
    other = {
      'x-dev-user-id': `feedback-other-${marker}`,
      'x-dev-user-email': `other-${marker}@example.com`
    };
    owner = {
      'x-dev-user-id': `feedback-owner-${marker}`,
      'x-dev-user-email': `owner-${marker}@example.com`,
      'x-feedback-password': 'Aiden'
    };
    admin = {
      'x-dev-user-id': `feedback-admin-${marker}`,
      'x-dev-user-email': `admin-${marker}@example.com`
    };
    const { ensureUserFromPrincipal } = await import('./services/user-service.js');
    for (const headers of [teacher, other, owner, admin]) {
      const user = await ensureUserFromPrincipal({
        clerkUserId: headers['x-dev-user-id']!,
        email: headers['x-dev-user-email']!
      });
      if (headers === owner)
        await db.pool.query('INSERT INTO platform_support_users(user_id) VALUES($1)', [user.id]);
      const school = await db.pool.query(
        'INSERT INTO schools(name,invite_code) VALUES($1,$2) RETURNING id',
        [`School ${marker}`, randomUUID()]
      );
      await db.pool.query(
        'INSERT INTO teacher_profiles(user_id,school_id,role,onboarded) VALUES($1,$2,$3,true)',
        [user.id, school.rows[0].id, headers === admin ? 'admin' : 'teacher']
      );
      await db.pool.query(
        'INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,$3)',
        [user.id, school.rows[0].id, headers === admin ? 'admin' : 'teacher']
      );
    }
  });
  afterAll(async () => {
    await app?.close();
    await db?.pool.end();
  });

  it('saves a report with authoritative identity and a durable outbox notification', async () => {
    const response = await submit();
    expect(response.statusCode).toBe(200);
    const saved = response.json();
    expect(saved.referenceNumber).toMatch(/^FB-\d+$/);
    const rows = await db.pool.query(
      'SELECT r.*,u.clerk_user_id FROM feedback_reports r JOIN users u ON u.id=r.reporter_user_id WHERE r.id=$1',
      [saved.id]
    );
    expect(rows.rows[0].clerk_user_id).toBe(teacher['x-dev-user-id']);
    const deliveries = await db.pool.query(
      'SELECT * FROM feedback_notification_deliveries WHERE report_id=$1',
      [saved.id]
    );
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0].delivery_status).toBe('pending');
    expect(deliveries.rows[0].recipient_identifier).toBe('am@aidanmccormick.com');
    expect(
      (await db.pool.query('SELECT * FROM feedback_events WHERE report_id=$1', [saved.id])).rows
    ).toHaveLength(1);
  });
  it('deduplicates concurrent retries and produces one email delivery', async () => {
    const body = reportBody();
    const responses = await Promise.all([
      submit(teacher, body),
      submit(teacher, body),
      submit(teacher, body)
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const ids = new Set(responses.map((r) => r.json<{ id: string }>().id));
    expect(ids.size).toBe(1);
    expect(
      (
        await db.pool.query('SELECT * FROM feedback_notification_deliveries WHERE report_id=$1', [
          [...ids][0]
        ])
      ).rows
    ).toHaveLength(1);
  });
  it('rejects malformed requests without persisting reports', async () => {
    for (const body of [
      { ...reportBody(), description: '' },
      { ...reportBody(), category: 'invalid' },
      { ...reportBody(), reporterUserId: randomUUID() }
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/v1/feedback', headers: teacher, payload: body }))
          .statusCode
      ).toBe(400);
    }
  });
  it('isolates teacher, school admin, and unauthenticated report/attachment access', async () => {
    const report = (await submit()).json();
    for (const headers of [other, admin, {}]) {
      const expected = Object.keys(headers).length ? 403 : 401;
      expect(
        (await app.inject({ method: 'GET', url: `/v1/feedback/${report.id}`, headers })).statusCode
      ).toBe(Object.keys(headers).length ? 404 : 401);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/feedback/${report.id}/attachments/${randomUUID()}`,
            headers
          })
        ).statusCode
      ).toBe(expected);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/management/feedback', headers })).statusCode
      ).toBe(Object.keys(headers).length ? 403 : 401);
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/management/feedback/${report.id}`,
          headers: teacher,
          payload: { status: 'fixed' }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/feedback/access', headers: admin })).json()
    ).toEqual({ isSupport: false });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/management/feedback',
          headers: { ...teacher, 'x-feedback-password': 'incorrect' }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/management/feedback', headers: owner }))
        .statusCode
    ).toBe(200);
  });
  it('does not elevate a user who changes their onboarding email to the owner email', async () => {
    const forged = {
      'x-dev-user-id': `forged-${randomUUID()}`,
      'x-dev-user-email': 'am@aidanmccormick.com'
    };
    expect(
      (await app.inject({ method: 'GET', url: '/v1/feedback/access', headers: forged })).json()
    ).toEqual({ isSupport: false });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/management/feedback', headers: forged }))
        .statusCode
    ).toBe(403);
  });
  it('stores developer notes while teachers cannot access reports or reply', async () => {
    const report = (await submit()).json();
    await app.inject({
      method: 'POST',
      url: `/v1/management/feedback/${report.id}/replies`,
      headers: owner,
      payload: { message: 'Private triage note', visibility: 'internal' }
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/v1/management/feedback/${report.id}/replies`,
      headers: owner,
      payload: { message: 'We are investigating.', visibility: 'teacher' }
    });
    expect(sent.statusCode).toBe(400);
    const teacherDetail = await app.inject({
      method: 'GET',
      url: `/v1/feedback/${report.id}`,
      headers: teacher
    });
    expect(teacherDetail.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/feedback/my', headers: teacher })).statusCode
    ).toBe(404);
    const notice = await db.pool.query(
      "SELECT * FROM feedback_notification_deliveries WHERE report_id=$1 AND notification_type='teacher_reply'",
      [report.id]
    );
    expect(notice.rows).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/feedback/${report.id}/replies`,
          headers: teacher,
          payload: { message: 'Escalation', visibility: 'internal' }
        })
      ).statusCode
    ).toBe(404);
  });
  it('supports owner filtering, status audit, grouping, and ungrouping', async () => {
    const first = (await submit()).json();
    const second = (await submit()).json();
    const list = await app.inject({
      method: 'GET',
      url: '/v1/management/feedback?category=bug&search=Lesson&page=1',
      headers: owner
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().reports.some((r: { id: string }) => r.id === first.id)).toBe(true);
    const group = await app.inject({
      method: 'POST',
      url: '/v1/management/feedback/groups',
      headers: owner,
      payload: { title: 'Reorder errors', reportIds: [first.id, second.id] }
    });
    expect(group.statusCode).toBe(200);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/management/feedback/${first.id}`,
      headers: owner,
      payload: { status: 'fixed', priority: 'high', issueGroupId: null }
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().report.resolvedAt).toBeTruthy();
    const detail = (
      await app.inject({
        method: 'GET',
        url: `/v1/management/feedback/${first.id}`,
        headers: owner
      })
    ).json();
    expect(detail.history.length).toBeGreaterThanOrEqual(2);
    expect(detail.report.diagnostics.errors).toHaveLength(1);
  });
  it('validates, stores and privately streams real screenshot bytes; deletion removes objects', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#ffffff' }
    })
      .png()
      .toBuffer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: teacher,
      payload: {
        ...reportBody(),
        attachment: { dataUrl: `data:image/png;base64,${png.toString('base64')}` }
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().attachmentWarning).toBeUndefined();
    const id = response.json().id;
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/management/feedback/${id}`, headers: owner })
    ).json();
    expect(detail.attachments).toHaveLength(1);
    const attachmentUrl = `/v1/feedback/${id}/attachments/${detail.attachments[0].id}`;
    for (const headers of [other, admin])
      expect((await app.inject({ method: 'GET', url: attachmentUrl, headers })).statusCode).toBe(
        404
      );
    for (const headers of [teacher, owner]) {
      const image = await app.inject({ method: 'GET', url: attachmentUrl, headers });
      expect(image.statusCode).toBe(200);
      expect(image.headers['content-type']).toMatch(/image\/png/);
      expect(image.headers['cache-control']).toBe('private, no-store');
      expect((await sharp(image.rawPayload).metadata()).width).toBe(10);
    }
    const count = fakeObjects.size;
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/management/feedback/${id}`, headers: owner }))
        .statusCode
    ).toBe(200);
    expect(fakeObjects.size).toBe(count - 1);
    expect(
      (await app.inject({ method: 'GET', url: attachmentUrl, headers: owner })).statusCode
    ).toBe(404);
  });

  it('retains written feedback when screenshot validation fails', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: teacher,
      payload: { ...reportBody(), attachment: { dataUrl: 'data:image/png;base64,aW52YWxpZA==' } }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().attachmentWarning).toMatch(/saved/);
    expect(
      (
        await db.pool.query('SELECT description FROM feedback_reports WHERE id=$1', [
          response.json().id
        ])
      ).rows[0].description
    ).toBe('Lesson reorder failed');
  });
  it('saves without optional diagnostics and enforces a durable per-user hourly limit', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: teacher,
      payload: {
        clientReportId: randomUUID(),
        category: 'other',
        description: 'A quick suggestion',
        pagePath: '/today'
      }
    });
    expect(result.statusCode).toBe(200);
    const report = result.json();
    const user = await db.pool.query('SELECT reporter_user_id FROM feedback_reports WHERE id=$1', [
      report.id
    ]);
    await db.pool.query(
      "INSERT INTO feedback_reports(reporter_user_id,category,description,page_path,client_report_id) SELECT $1,'other','rate limit test','/today',gen_random_uuid() FROM generate_series(1,29)",
      [user.rows[0].reporter_user_id]
    );
    expect((await submit()).statusCode).toBe(429);
  });
});
