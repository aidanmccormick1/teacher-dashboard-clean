import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '@teacheros/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';

import { createS3Client } from '../lib/s3.js';
import { ensureUserFromPrincipal } from '../services/user-service.js';
import { FeedbackSubmissionSchema } from '../services/feedback-sanitization.js';

const statuses = ['new', 'investigating', 'planned', 'fixed', 'closed'] as const;
const priorities = ['low', 'normal', 'high', 'critical'] as const;
const params = z.object({ id: z.string().uuid() });
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(
      400,
      `Invalid feedback request: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`
    );
  return result.data as z.output<S>;
}
export function camelFeedbackRow(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(camelFeedbackRow);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camelFeedbackRow(v)
      ])
    );
  return value;
}
async function currentUser(request: FastifyRequest) {
  if (!request.principal) fail(401, 'Authentication is required.');
  return ensureUserFromPrincipal(request.principal);
}
export async function isFeedbackSupport(userId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM platform_support_users WHERE user_id=$1', [
    userId
  ]);
  return result.rows.length > 0;
}
async function requireSupport(request: FastifyRequest) {
  const user = await currentUser(request);
  const candidate = request.headers['x-feedback-password'];
  if (!matchesFeedbackInboxPassword(candidate, request.server.config.FEEDBACK_INBOX_PASSWORD))
    fail(403, 'Enter the developer inbox password.');
  return user;
}
export function matchesFeedbackInboxPassword(candidate: unknown, configured?: string): boolean {
  const provided = createHash('sha256')
    .update(typeof candidate === 'string' ? candidate : '')
    .digest();
  const expected = createHash('sha256')
    .update(configured ?? 'Aiden')
    .digest();
  return timingSafeEqual(provided, expected);
}
async function authorizedReport(id: string, userId: string, support: boolean) {
  const result = await pool.query(
    'SELECT * FROM feedback_reports WHERE id=$1 AND ($2::boolean OR reporter_user_id=$3)',
    [id, support, userId]
  );
  if (!result.rows[0]) fail(404, 'Feedback report not found.');
  return result.rows[0] as Record<string, unknown>;
}

export async function feedbackRoutes(app: FastifyInstance) {
  const s3 = createS3Client(app.config);
  const bucket = app.config.FEEDBACK_S3_BUCKET;
  app.addHook('onClose', async () => {
    s3?.destroy();
  });
  app.get('/v1/feedback/access', async (request) => ({
    isSupport: await isFeedbackSupport((await currentUser(request)).id)
  }));

  app.post(
    '/v1/feedback',
    {
      bodyLimit: 8 * 1024 * 1024,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) => request.principal?.clerkUserId ?? request.ip
        }
      }
    },
    async (request) => {
      const user = await currentUser(request);
      const body = parse(FeedbackSubmissionSchema, request.body);
      const client = await pool.connect();
      let report: Record<string, unknown>;
      try {
        await client.query('BEGIN');
        // A database advisory lock makes retries and rate checks atomic across API instances.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
        const existing = await client.query(
          'SELECT id,reference_number,status,attachment_status FROM feedback_reports WHERE reporter_user_id=$1 AND client_report_id=$2',
          [user.id, body.clientReportId]
        );
        if (existing.rows[0]) report = existing.rows[0];
        else {
          const count = await client.query(
            "SELECT count(*)::int AS count FROM feedback_reports WHERE reporter_user_id=$1 AND created_at>now()-interval '1 hour'",
            [user.id]
          );
          if (count.rows[0].count >= 30)
            fail(429, 'You have sent several reports recently. Please try again in an hour.');
          const school = await client.query(
            'SELECT school_id FROM teacher_profiles WHERE user_id=$1',
            [user.id]
          );
          const result = await client.query(
            `INSERT INTO feedback_reports
          (reporter_user_id,school_id,category,description,expected_behavior,reproduction_steps,page_path,page_name,sanitized_url,context,diagnostics,client_session_id,client_report_id,error_fingerprint,app_version,commit_sha,environment)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id,reference_number,status,attachment_status`,
            [
              user.id,
              school.rows[0]?.school_id ?? null,
              body.category,
              body.description,
              body.expectedBehavior ?? null,
              body.reproductionSteps ?? null,
              body.pagePath,
              body.pageName ?? null,
              body.sanitizedUrl ?? body.pagePath,
              body.context ?? {},
              body.diagnostics ?? {},
              body.clientSessionId ?? body.diagnostics?.clientSessionId ?? null,
              body.clientReportId,
              body.diagnostics?.errors?.at(-1)?.fingerprint ?? null,
              body.appVersion ?? body.diagnostics?.app?.version ?? null,
              body.commitSha ?? body.diagnostics?.app?.commitSha ?? null,
              body.environment ?? body.diagnostics?.app?.environment ?? null
            ]
          );
          report = result.rows[0];
          for (const event of body.diagnostics?.events ?? [])
            await client.query(
              'INSERT INTO feedback_events(report_id,event_timestamp,event_type,metadata) VALUES($1,$2,$3,$4)',
              [report.id, event.timestamp, event.type, event.metadata ?? {}]
            );
          if (body.attachment)
            await client.query(
              "UPDATE feedback_reports SET attachment_status='pending' WHERE id=$1",
              [report.id]
            );
          await client.query(
            "INSERT INTO feedback_notification_deliveries(report_id,notification_type,recipient_identifier,next_attempt_at) VALUES($1,'new_report',$2,now()+($3 * interval '1 second'))",
            [report.id, app.config.FEEDBACK_NOTIFICATION_EMAIL, body.attachment ? 120 : 0]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      let attachmentWarning: string | undefined;
      let attachClaimed = false;
      if (body.attachment) {
        const claim = await pool.query(
          "UPDATE feedback_reports SET attachment_status='uploading',attachment_started_at=now() WHERE id=$1 AND (attachment_status IN ('pending','failed') OR (attachment_status='uploading' AND attachment_started_at<now()-interval '2 minutes')) RETURNING id",
          [report.id]
        );
        attachClaimed = claim.rows.length > 0;
      }
      if (attachClaimed && body.attachment) {
        const key = `feedback/${String(report.id)}/${randomUUID()}.png`;
        try {
          const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
            body.attachment.dataUrl
          );
          if (!match) throw new Error('invalid_image');
          const bytes = Buffer.from(match[2]!, 'base64');
          if (bytes.length > 5 * 1024 * 1024) throw new Error('image_too_large');
          const image = sharp(bytes, { limitInputPixels: 16_000_000 });
          const metadata = await image.metadata();
          if (
            !['png', 'jpeg'].includes(metadata.format ?? '') ||
            !metadata.width ||
            !metadata.height ||
            metadata.width > 8000 ||
            metadata.height > 8000 ||
            (metadata.pages ?? 1) > 1
          )
            throw new Error('invalid_dimensions');
          // Decode and re-encode, stripping metadata and rejecting malformed/polyglot uploads.
          const data = await image.png().toBuffer();
          if (data.length > 5 * 1024 * 1024) throw new Error('image_too_large');
          let storedInS3 = false;
          if (s3 && bucket) {
            try {
              await s3.send(
                new PutObjectCommand({
                  Bucket: bucket,
                  Key: key,
                  Body: data,
                  ContentType: 'image/png'
                })
              );
              storedInS3 = true;
            } catch {
              request.log.warn({ reportId: report.id }, 'Using database screenshot storage');
            }
          }
          try {
            await pool.query(
              'INSERT INTO feedback_attachments(report_id,storage_object_path,mime_type,file_size,width,height,image_data) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                report.id,
                storedInS3 ? key : null,
                'image/png',
                data.length,
                metadata.width,
                metadata.height,
                storedInS3 ? null : data
              ]
            );
            await pool.query(
              "UPDATE feedback_reports SET attachment_status='attached' WHERE id=$1",
              [report.id]
            );
          } catch (error) {
            if (storedInS3) await s3!.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
            throw error;
          }
        } catch {
          const state = await pool.query(
            "UPDATE feedback_reports SET attachment_status=CASE WHEN EXISTS(SELECT 1 FROM feedback_attachments WHERE report_id=$1) THEN 'attached' ELSE 'failed' END WHERE id=$1 RETURNING attachment_status",
            [report.id]
          );
          if (state.rows[0]?.attachment_status !== 'attached')
            attachmentWarning =
              'Your feedback was saved, but the screenshot could not be attached.';
        } finally {
          await pool.query(
            "UPDATE feedback_notification_deliveries SET next_attempt_at=now() WHERE report_id=$1 AND notification_type='new_report' AND delivery_status='pending'",
            [report.id]
          );
        }
      }
      if (body.attachment && !attachClaimed) {
        const attachmentState = await pool.query(
          'SELECT attachment_status FROM feedback_reports WHERE id=$1',
          [report.id]
        );
        if (attachmentState.rows[0]?.attachment_status !== 'attached')
          attachmentWarning =
            'Your feedback was saved. Screenshot processing is still pending; check your report before sending another copy.';
      }
      const delivery = await pool.query(
        'SELECT delivery_status FROM feedback_notification_deliveries WHERE report_id=$1 AND notification_type=$2',
        [report.id, 'new_report']
      );
      return {
        ...(camelFeedbackRow(report) as Record<string, unknown>),
        notificationStatus: delivery.rows[0]?.delivery_status ?? 'pending',
        ...(attachmentWarning ? { attachmentWarning } : {})
      };
    }
  );

  app.get('/v1/management/feedback', async (request) => {
    await requireSupport(request);
    const q = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          category: z.enum(['bug', 'feature_request', 'usability', 'other']).optional(),
          status: z.enum(statuses).optional(),
          priority: z.enum(priorities).optional(),
          search: z.string().max(200).optional()
        })
        .strict(),
      request.query
    );
    const values: unknown[] = [];
    const clauses: string[] = [];
    for (const [key, value] of [
      ['category', q.category],
      ['status', q.status],
      ['priority', q.priority]
    ])
      if (value) {
        values.push(value);
        clauses.push(`r.${key}=$${values.length}`);
      }
    if (q.search) {
      values.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(
        `(r.reference_number ILIKE $${values.length} OR r.description ILIKE $${values.length} OR r.page_name ILIKE $${values.length} OR u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR r.context::text ILIKE $${values.length})`
      );
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = await pool.query(
      `SELECT count(*)::int AS total FROM feedback_reports r JOIN users u ON u.id=r.reporter_user_id ${where}`,
      values
    );
    const result = await pool.query(
      `SELECT r.*, u.full_name AS reporter_name,u.email AS reporter_email,s.name AS school_name,(SELECT count(*)::int FROM feedback_attachments a WHERE a.report_id=r.id) AS attachment_count,(SELECT count(DISTINCT x.reporter_user_id)::int FROM feedback_reports x WHERE x.issue_group_id=r.issue_group_id) AS group_teacher_count FROM feedback_reports r JOIN users u ON u.id=r.reporter_user_id LEFT JOIN schools s ON s.id=r.school_id ${where} ORDER BY r.created_at DESC LIMIT 25 OFFSET $${values.length + 1}`,
      [...values, (q.page - 1) * 25]
    );
    const metrics = await pool.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE status='new')::int AS new,count(*) FILTER(WHERE category='bug' AND status NOT IN ('fixed','closed'))::int AS open_bugs,count(*) FILTER(WHERE status='investigating')::int AS investigating,count(*) FILTER(WHERE status='fixed')::int AS resolved,count(*) FILTER(WHERE created_at>now()-interval '7 days')::int AS last_seven_days FROM feedback_reports`
    );
    return {
      reports: camelFeedbackRow(result.rows),
      total: total.rows[0].total,
      page: q.page,
      pageSize: 25,
      metrics: camelFeedbackRow(metrics.rows[0])
    };
  });

  async function detail(request: FastifyRequest, management: boolean) {
    const user = management ? await requireSupport(request) : await currentUser(request);
    const support = management || (await isFeedbackSupport(user.id));
    const { id } = parse(params, request.params);
    const report = await authorizedReport(id, user.id, support);
    const attachments = await pool.query(
      'SELECT id,report_id,mime_type,file_size,width,height,attachment_type,created_at FROM feedback_attachments WHERE report_id=$1',
      [id]
    );
    const replies = await pool.query(
      `SELECT r.id,r.report_id,r.author_user_id,r.message,r.visibility,r.created_at,u.full_name AS author_name FROM feedback_replies r JOIN users u ON u.id=r.author_user_id WHERE report_id=$1 ${support ? '' : "AND visibility='teacher'"} ORDER BY created_at`,
      [id]
    );
    if (!support) {
      const teacherReport = { ...report };
      for (const key of [
        'diagnostics',
        'context',
        'client_session_id',
        'client_report_id',
        'error_fingerprint'
      ])
        delete teacherReport[key];
      return {
        report: camelFeedbackRow(teacherReport),
        attachments: camelFeedbackRow(attachments.rows),
        replies: camelFeedbackRow(replies.rows),
        events: [],
        history: [],
        relatedReports: [],
        deliveries: []
      };
    }
    const reporter = await pool.query(
      'SELECT u.full_name AS reporter_name,u.email AS reporter_email,s.name AS school_name FROM users u LEFT JOIN schools s ON s.id=$2 WHERE u.id=$1',
      [report.reporter_user_id, report.school_id]
    );
    const events = await pool.query(
      'SELECT * FROM feedback_events WHERE report_id=$1 ORDER BY event_timestamp',
      [id]
    );
    const history = await pool.query(
      'SELECT * FROM feedback_history WHERE report_id=$1 ORDER BY created_at',
      [id]
    );
    const deliveries = await pool.query(
      'SELECT id,notification_type,delivery_status,attempt_count,last_attempted_at,sent_at,error_code FROM feedback_notification_deliveries WHERE report_id=$1 ORDER BY created_at',
      [id]
    );
    const related = await pool.query(
      `SELECT id,reference_number,description,page_name,status,issue_group_id FROM feedback_reports WHERE id<>$1 AND ((error_fingerprint=$2 AND page_path=$3) OR (issue_group_id=$4 AND $4 IS NOT NULL) OR (page_path=$3 AND (($5::text IS NOT NULL AND diagnostics->'network'->-1->>'endpoint'=$5) OR ($6::text IS NOT NULL AND context->>'component'=$6)))) ORDER BY created_at DESC LIMIT 10`,
      [
        id,
        report.error_fingerprint,
        report.page_path,
        report.issue_group_id,
        (report.diagnostics as { network?: { endpoint?: string }[] })?.network?.at(-1)?.endpoint ??
          null,
        (report.context as { component?: string })?.component ?? null
      ]
    );
    const supportUsers = await pool.query(
      'SELECT u.id,u.full_name AS name,u.email FROM platform_support_users p JOIN users u ON u.id=p.user_id ORDER BY u.full_name'
    );
    const groups = await pool.query(
      'SELECT g.*, (SELECT count(DISTINCT r.reporter_user_id)::int FROM feedback_reports r WHERE r.issue_group_id=g.id) AS teacher_count FROM feedback_issue_groups g ORDER BY g.created_at DESC LIMIT 200'
    );
    return {
      report: camelFeedbackRow({ ...report, ...reporter.rows[0] }),
      attachments: camelFeedbackRow(attachments.rows),
      replies: camelFeedbackRow(replies.rows),
      events: camelFeedbackRow(events.rows),
      history: camelFeedbackRow(history.rows),
      relatedReports: camelFeedbackRow(related.rows),
      deliveries: camelFeedbackRow(deliveries.rows),
      supportUsers: camelFeedbackRow(supportUsers.rows),
      groups: camelFeedbackRow(groups.rows)
    };
  }
  app.get('/v1/management/feedback/:id', (request) => detail(request, true));

  app.get('/v1/feedback/:id/attachments/:attachmentId', async (request, reply) => {
    const user = await requireSupport(request);
    const support = true;
    const { id, attachmentId } = parse(
      params.extend({ attachmentId: z.string().uuid() }),
      request.params
    );
    await authorizedReport(id, user.id, support);
    const result = await pool.query(
      'SELECT * FROM feedback_attachments WHERE id=$1 AND report_id=$2',
      [attachmentId, id]
    );
    const attachment = result.rows[0];
    if (!attachment) fail(404, 'Screenshot not found.');
    let data: Buffer = attachment.image_data;
    if (!data) {
      if (!s3 || !bucket) fail(503, 'Private screenshot storage is not configured.');
      const object = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: attachment.storage_object_path })
      );
      if (!object.Body) fail(404, 'Screenshot not found.');
      data = Buffer.from(await object.Body.transformToByteArray());
    }
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(attachment.mime_type);
    return reply.send(data);
  });

  app.patch('/v1/management/feedback/:id', async (request) => {
    const user = await requireSupport(request);
    const { id } = parse(params, request.params);
    const body = parse(
      z
        .object({
          status: z.enum(statuses).optional(),
          priority: z.enum(priorities).optional(),
          assignedTo: z.string().uuid().nullable().optional(),
          issueGroupId: z.string().uuid().nullable().optional()
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0),
      request.body
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM feedback_reports WHERE id=$1 FOR UPDATE', [
        id
      ]);
      if (!result.rows[0]) fail(404, 'Feedback report not found.');
      const old = result.rows[0];
      if (
        body.assignedTo &&
        !(
          await client.query('SELECT 1 FROM platform_support_users WHERE user_id=$1', [
            body.assignedTo
          ])
        ).rows.length
      )
        fail(400, 'Assignment requires an authorized support user.');
      if (
        body.issueGroupId &&
        !(
          await client.query('SELECT 1 FROM feedback_issue_groups WHERE id=$1', [body.issueGroupId])
        ).rows.length
      )
        fail(400, 'Issue group not found.');
      const updated = await client.query(
        "UPDATE feedback_reports SET status=$2,priority=$3,assigned_to=$4,issue_group_id=$5,updated_at=now(),resolved_at=CASE WHEN $2 IN ('fixed','closed') THEN coalesce(resolved_at,now()) ELSE NULL END WHERE id=$1 RETURNING *",
        [
          id,
          body.status ?? old.status,
          body.priority ?? old.priority,
          body.assignedTo === undefined ? old.assigned_to : body.assignedTo,
          body.issueGroupId === undefined ? old.issue_group_id : body.issueGroupId
        ]
      );
      await client.query(
        'INSERT INTO feedback_history(report_id,author_user_id,changes) VALUES($1,$2,$3)',
        [
          id,
          user.id,
          Object.fromEntries(
            Object.entries(body).map(([key, value]) => [
              key,
              { from: old[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)], to: value }
            ])
          )
        ]
      );
      await client.query('COMMIT');
      return { report: camelFeedbackRow(updated.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  async function replyToReport(request: FastifyRequest, management: boolean) {
    const user = management ? await requireSupport(request) : await currentUser(request);
    const support = management || (await isFeedbackSupport(user.id));
    const { id } = parse(params, request.params);
    await authorizedReport(id, user.id, support);
    const body = parse(
      z
        .object({
          message: z.string().trim().min(1).max(10000),
          visibility: z.literal('internal').default('internal')
        })
        .strict(),
      request.body
    );
    if (body.visibility === 'internal' && !support)
      fail(403, 'Private notes require platform support access.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO feedback_replies(report_id,author_user_id,message,visibility) VALUES($1,$2,$3,$4) RETURNING *',
        [id, user.id, body.message, body.visibility]
      );
      await client.query('UPDATE feedback_reports SET updated_at=now() WHERE id=$1', [id]);
      await client.query('COMMIT');
      return { reply: camelFeedbackRow(result.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  app.post(
    '/v1/management/feedback/:id/replies',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    (request) => replyToReport(request, true)
  );

  app.post('/v1/management/feedback/:id/retry-notifications', async (request) => {
    await requireSupport(request);
    const { id } = parse(params, request.params);
    const body = parse(
      z.object({ confirmOutcomeReviewed: z.boolean().optional() }).strict(),
      request.body ?? {}
    );
    const ambiguous = await pool.query(
      "SELECT 1 FROM feedback_notification_deliveries WHERE report_id=$1 AND error_code='delivery_outcome_requires_review'",
      [id]
    );
    if (ambiguous.rows.length && !body.confirmOutcomeReviewed)
      fail(
        409,
        'Review the provider delivery outcome before explicitly replaying this notification.'
      );
    const result = await pool.query(
      "UPDATE feedback_notification_deliveries SET delivery_status='pending',next_attempt_at=now(),locked_until=NULL,error_code=NULL,attempt_count=0,first_attempted_at=NULL WHERE report_id=$1 AND delivery_status IN ('failed','configuration_blocked') RETURNING id",
      [id]
    );
    return { queued: result.rowCount };
  });
  app.post('/v1/management/feedback/groups', async (request) => {
    const user = await requireSupport(request);
    const body = parse(
      z
        .object({
          title: z.string().trim().min(1).max(200),
          reportIds: z.array(z.string().uuid()).min(1).max(100)
        })
        .strict(),
      request.body
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = [...new Set(body.reportIds)];
      const found = await client.query(
        'SELECT id,issue_group_id FROM feedback_reports WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      if (found.rows.length !== ids.length) fail(404, 'A feedback report was not found.');
      const group = await client.query(
        'INSERT INTO feedback_issue_groups(title) VALUES($1) RETURNING *',
        [body.title]
      );
      await client.query(
        'UPDATE feedback_reports SET issue_group_id=$1,updated_at=now() WHERE id=ANY($2::uuid[])',
        [group.rows[0].id, ids]
      );
      for (const old of found.rows)
        await client.query(
          'INSERT INTO feedback_history(report_id,author_user_id,changes) VALUES($1,$2,$3)',
          [old.id, user.id, { issueGroupId: { from: old.issue_group_id, to: group.rows[0].id } }]
        );
      await client.query('COMMIT');
      return { group: camelFeedbackRow(group.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.delete('/v1/management/feedback/:id', async (request) => {
    const user = await requireSupport(request);
    const { id } = parse(params, request.params);
    await authorizedReport(id, user.id, true);
    const attachments = await pool.query(
      'SELECT storage_object_path FROM feedback_attachments WHERE report_id=$1 AND storage_object_path IS NOT NULL',
      [id]
    );
    if (attachments.rows.length && (!s3 || !bucket))
      fail(503, 'Configure private storage before deleting attached reports.');
    for (const attachment of attachments.rows)
      await s3!.send(
        new DeleteObjectCommand({ Bucket: bucket!, Key: attachment.storage_object_path })
      );
    await pool.query('DELETE FROM feedback_reports WHERE id=$1', [id]);
    return { deleted: true };
  });
}
