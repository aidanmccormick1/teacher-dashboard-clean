import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { pool } from '@teacheros/db';
import { Resend } from 'resend';

import type { AppConfig } from '../config.js';
import { createS3Client } from '../lib/s3.js';

export interface FeedbackEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface Delivery {
  id: string;
  report_id: string;
  notification_type: string;
  recipient_identifier: string;
  reply_id: string | null;
  attempt_count: number;
  payload: FeedbackEmail | null;
  created_at: Date;
  first_attempted_at: Date | null;
}

interface ReportEmailContext {
  id: string;
  reference_number: string;
  category: string;
  description: string;
  expected_behavior: string | null;
  reproduction_steps: string | null;
  page_name: string | null;
  page_path: string;
  sanitized_url: string | null;
  context: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  app_version: string | null;
  commit_sha: string | null;
  status: string;
  priority: string;
  created_at: Date;
  reporter_name: string | null;
  reporter_email: string;
  school_name: string | null;
  attachment_count: string;
  reply_message: string | null;
}

type DeliveryConfig = Pick<
  AppConfig,
  'FEEDBACK_EMAIL_ENABLED' | 'RESEND_API_KEY' | 'FEEDBACK_EMAIL_FROM' | 'APP_PUBLIC_URL'
>;

export function feedbackEmailConfigurationError(config: DeliveryConfig): string | null {
  if (!config.FEEDBACK_EMAIL_ENABLED) return 'email_disabled';
  if (!config.RESEND_API_KEY || !config.FEEDBACK_EMAIL_FROM || !config.APP_PUBLIC_URL) {
    return 'email_configuration_missing';
  }
  if (!/^https?:\/\//.test(config.APP_PUBLIC_URL)) return 'email_configuration_invalid';
  return null;
}

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]!
  );
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not available';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function diagnosticSummary(value: unknown, fields: string[], count: number): string {
  if (!Array.isArray(value)) return 'Not available';
  return (
    value
      .slice(-count)
      .map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return '';
        const record = entry as Record<string, unknown>;
        return fields
          .flatMap((field) => {
            const item = record[field];
            return typeof item === 'string' || typeof item === 'number'
              ? [`${field}: ${String(item).slice(0, 250)}`]
              : [];
          })
          .join(' | ');
      })
      .filter(Boolean)
      .join('\n') || 'None captured'
  );
}

export function buildFeedbackEmail(
  config: Pick<AppConfig, 'FEEDBACK_EMAIL_FROM' | 'APP_PUBLIC_URL'>,
  delivery: Pick<Delivery, 'notification_type' | 'recipient_identifier'>,
  report: ReportEmailContext
): FeedbackEmail {
  const isReply = delivery.notification_type === 'teacher_reply';
  const reportUrl = new URL(
    isReply ? `/feedback/${report.id}` : `/management/feedback/${report.id}`,
    config.APP_PUBLIC_URL
  ).toString();
  const category = report.category.replaceAll('_', ' ').toUpperCase();
  const title = isReply
    ? `Reply to ${report.reference_number}`
    : `${category} | ${report.page_name || report.page_path} | ${report.reference_number}`;
  const heading = isReply ? 'TeacherOS feedback reply' : 'New TeacherOS feedback';
  const common: Array<[string, unknown]> = [
    ['Reference', report.reference_number],
    ['Status', report.status]
  ];
  const fields: Array<[string, unknown]> = isReply
    ? [...common, ['Response', report.reply_message]]
    : [
        ...common,
        ['Category', report.category],
        ['Priority', report.priority],
        ['Submitted (UTC)', new Date(report.created_at).toISOString()],
        ['Teacher', report.reporter_name],
        ['Teacher email', report.reporter_email],
        ['School', report.school_name],
        ['What happened', report.description],
        ['Expected behavior', report.expected_behavior],
        ['Steps to reproduce', report.reproduction_steps],
        ['Page', report.page_name || report.page_path],
        ['URL', report.sanitized_url || report.page_path],
        ['Relevant identifiers', report.context],
        [
          'Browser and device',
          report.diagnostics.browser ?? report.diagnostics.environment ?? report.diagnostics.device
        ],
        ['App version', report.app_version],
        ['Commit', report.commit_sha],
        [
          'Recent errors',
          diagnosticSummary(
            report.diagnostics.errors,
            ['category', 'message', 'fingerprint', 'correlationId'],
            3
          )
        ],
        [
          'Failed API requests',
          diagnosticSummary(
            report.diagnostics.network,
            ['method', 'endpoint', 'status', 'requestId'],
            3
          )
        ],
        [
          'Recent actions',
          diagnosticSummary(
            report.diagnostics.events ?? report.diagnostics.activity,
            ['type', 'timestamp'],
            10
          )
        ],
        [
          'Screenshot',
          Number(report.attachment_count) > 0 ? 'Available in the private report' : 'Not included'
        ]
      ];
  const text = `${heading}\n\n${fields.map(([label, value]) => `${label}:\n${display(value)}`).join('\n\n')}\n\nView Full Feedback Report:\n${reportUrl}`;
  const html = `<html><body style="font-family:Arial,sans-serif;color:#172033;max-width:680px;margin:auto;padding:24px"><h1>${heading}</h1>${fields.map(([label, value]) => `<h2 style="font-size:14px;margin:24px 0 6px">${escapeEmailHtml(label)}</h2><p style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${escapeEmailHtml(display(value))}</p>`).join('')}<p style="margin-top:28px"><a href="${escapeEmailHtml(reportUrl)}">View Full Feedback Report</a></p></body></html>`;
  return {
    from: config.FEEDBACK_EMAIL_FROM!,
    to: delivery.recipient_identifier,
    subject: `[TeacherOS Feedback] ${title.replace(/[\r\n]/g, ' ').slice(0, 180)}`,
    html,
    text
  };
}

export interface DeliveryStore {
  claim(): Promise<Delivery | null>;
  report(delivery: Delivery): Promise<ReportEmailContext | null>;
  savePayload(id: string, payload: FeedbackEmail): Promise<void>;
  complete(id: string, providerMessageId: string): Promise<void>;
  defer(
    id: string,
    status: 'configuration_blocked' | 'pending' | 'failed',
    errorCode: string,
    delaySeconds: number
  ): Promise<void>;
}

export interface FeedbackEmailProvider {
  send(
    payload: FeedbackEmail,
    idempotencyKey: string
  ): Promise<{ id?: string; errorCode?: string; permanent?: boolean }>;
}

export async function processFeedbackDelivery(
  config: DeliveryConfig,
  store: DeliveryStore,
  provider: FeedbackEmailProvider
): Promise<boolean> {
  const delivery = await store.claim();
  if (!delivery) return false;
  const blocked = feedbackEmailConfigurationError(config);
  if (blocked) {
    await store.defer(delivery.id, 'configuration_blocked', blocked, 60);
    return true;
  }
  // Resend retains idempotency keys for 24 hours. An ambiguous old attempt
  // requires operator review rather than risking a second notification.
  if (
    delivery.first_attempted_at &&
    Date.now() - new Date(delivery.first_attempted_at).getTime() > 23 * 60 * 60 * 1000
  ) {
    await store.defer(delivery.id, 'failed', 'delivery_outcome_requires_review', 0);
    return true;
  }
  try {
    let payload = delivery.payload;
    if (!payload) {
      const report = await store.report(delivery);
      if (!report) {
        await store.defer(delivery.id, 'failed', 'report_or_reply_missing', 0);
        return true;
      }
      payload = buildFeedbackEmail(config, delivery, report);
    }
    await store.savePayload(delivery.id, payload);
    const result = await provider.send(payload, `teacheros-feedback/${delivery.id}`);
    if (result.id) {
      await store.complete(delivery.id, result.id);
    } else {
      const attempts = delivery.attempt_count + 1;
      const failed = result.permanent || attempts >= 6;
      await store.defer(
        delivery.id,
        failed ? 'failed' : 'pending',
        /^[a-z0-9_]{1,64}$/i.test(result.errorCode ?? '') ? result.errorCode! : 'provider_error',
        Math.min(3600, 30 * 2 ** attempts)
      );
    }
  } catch {
    await store.defer(
      delivery.id,
      delivery.attempt_count + 1 >= 6 ? 'failed' : 'pending',
      'delivery_transport_error',
      Math.min(3600, 30 * 2 ** (delivery.attempt_count + 1))
    );
  }
  return true;
}

function createDeliveryStore(logger: {
  warn: (details: object, message: string) => void;
}): DeliveryStore {
  return {
    async claim() {
      const result = await pool.query<Delivery>(`
        UPDATE feedback_notification_deliveries SET delivery_status='processing', locked_until=now()+interval '2 minutes'
        WHERE id=(SELECT id FROM feedback_notification_deliveries
          WHERE ((delivery_status IN ('pending','configuration_blocked') AND next_attempt_at<=now())
            OR (delivery_status='processing' AND locked_until<now()))
          ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`);
      return result.rows[0] ?? null;
    },
    async report(delivery) {
      const result = await pool.query<ReportEmailContext>(
        `
        SELECT r.*, u.full_name reporter_name, u.email reporter_email, s.name school_name,
          (SELECT count(*) FROM feedback_attachments a WHERE a.report_id=r.id) attachment_count,
          p.message reply_message
        FROM feedback_reports r JOIN users u ON u.id=r.reporter_user_id
        LEFT JOIN schools s ON s.id=r.school_id
        LEFT JOIN feedback_replies p ON p.id=$2 AND p.report_id=r.id AND p.visibility='teacher'
        WHERE r.id=$1`,
        [delivery.report_id, delivery.reply_id]
      );
      const report = result.rows[0] ?? null;
      return delivery.notification_type === 'teacher_reply' && !report?.reply_message
        ? null
        : report;
    },
    async savePayload(id, payload) {
      await pool.query(
        `UPDATE feedback_notification_deliveries SET payload=$2, attempt_count=attempt_count+1,
        last_attempted_at=now(), first_attempted_at=coalesce(first_attempted_at,now()) WHERE id=$1`,
        [id, payload]
      );
    },
    async complete(id, messageId) {
      await pool.query(
        `UPDATE feedback_notification_deliveries SET delivery_status='sent', provider_message_id=$2,
        sent_at=now(), error_code=NULL, locked_until=NULL WHERE id=$1`,
        [id, messageId]
      );
    },
    async defer(id, status, errorCode, delaySeconds) {
      await pool.query(
        `UPDATE feedback_notification_deliveries SET delivery_status=$2, error_code=$3,
        next_attempt_at=now()+($4 * interval '1 second'), locked_until=NULL WHERE id=$1`,
        [id, status, errorCode, delaySeconds]
      );
      if (status === 'failed')
        logger.warn(
          { deliveryId: id, code: errorCode },
          'Feedback notification requires operator review'
        );
    }
  };
}

export async function cleanupFeedbackRetention(config: AppConfig): Promise<void> {
  const cutoff = new Date(Date.now() - config.FEEDBACK_RETENTION_DAYS * 86400000);
  const s3 = createS3Client(config);
  const bucket = config.FEEDBACK_S3_BUCKET;
  let storageFailed = false;
  if (s3 && bucket) {
    try {
      const attachments = await pool.query<{ id: string; storage_object_path: string }>(
        'SELECT id, storage_object_path FROM feedback_attachments WHERE created_at<$1 LIMIT 100',
        [cutoff]
      );
      for (const attachment of attachments.rows) {
        try {
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: attachment.storage_object_path })
          );
          await pool.query('DELETE FROM feedback_attachments WHERE id=$1', [attachment.id]);
        } catch {
          storageFailed = true;
        }
      }
    } finally {
      s3.destroy();
    }
  }
  await pool.query(
    `UPDATE feedback_reports SET diagnostics='{}' WHERE created_at<$1 AND diagnostics<>'{}'::jsonb`,
    [cutoff]
  );
  await pool.query('DELETE FROM feedback_events WHERE created_at<$1', [cutoff]);
  await pool.query(
    `UPDATE feedback_notification_deliveries SET payload=NULL,
    delivery_status=CASE WHEN delivery_status='processing' THEN 'failed' ELSE delivery_status END
    WHERE created_at<$1 AND payload IS NOT NULL`,
    [cutoff]
  );
  await pool.query(
    `DELETE FROM feedback_notification_deliveries WHERE created_at<$1 AND delivery_status IN ('sent','failed')`,
    [cutoff]
  );
  if (storageFailed) throw new Error('feedback_retention_storage_failed');
}

export async function cleanupAbandonedFeedbackUploads(
  config: AppConfig,
  continuationToken?: string
): Promise<string | undefined> {
  if (!config.FEEDBACK_S3_BUCKET) return undefined;
  const s3 = createS3Client(config);
  if (!s3) return undefined;
  try {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.FEEDBACK_S3_BUCKET,
        Prefix: 'feedback/',
        MaxKeys: 100,
        ContinuationToken: continuationToken
      })
    );
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const generatedKey = new RegExp(`^feedback/${uuid}/${uuid}\\.png$`, 'i');
    const candidates = (page.Contents ?? [])
      .slice(0, 100)
      .flatMap((object) =>
        object.Key &&
        generatedKey.test(object.Key) &&
        object.LastModified instanceof Date &&
        object.LastModified.getTime() < cutoff
          ? [object.Key]
          : []
      );
    if (candidates.length) {
      const attached = await pool.query<{ storage_object_path: string }>(
        'SELECT storage_object_path FROM feedback_attachments WHERE storage_object_path=ANY($1::text[])',
        [candidates]
      );
      const retained = new Set(attached.rows.map((attachment) => attachment.storage_object_path));
      for (const key of candidates) {
        if (!retained.has(key)) {
          await s3.send(new DeleteObjectCommand({ Bucket: config.FEEDBACK_S3_BUCKET, Key: key }));
        }
      }
    }
    return page.IsTruncated ? page.NextContinuationToken : undefined;
  } finally {
    s3.destroy();
  }
}

export function startFeedbackDeliveryWorker(
  config: AppConfig,
  logger: { warn: (details: object, message: string) => void }
): { stop(): Promise<void> } {
  const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;
  const provider: FeedbackEmailProvider = {
    async send(payload, idempotencyKey) {
      if (!resend) return { errorCode: 'email_configuration_missing', permanent: false };
      const { data, error } = await resend.emails.send(payload, { idempotencyKey });
      return error
        ? {
            errorCode: error.name,
            permanent: [
              'validation_error',
              'missing_required_field',
              'invalid_api_key',
              'restricted_api_key',
              'invalid_access',
              'invalid_parameter',
              'invalid_region',
              'idempotency_key_conflict'
            ].includes(error.name)
          }
        : { id: data?.id };
    }
  };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let lastCleanup = 0;
  let lastAbandonedScan = 0;
  let abandonedCursor: string | undefined;
  const tick = async () => {
    try {
      const store = createDeliveryStore(logger);
      for (let index = 0; !stopped && index < 20; index++) {
        if (!(await processFeedbackDelivery(config, store, provider))) break;
      }
      if (!stopped && Date.now() - lastCleanup > 3600000) {
        try {
          await cleanupFeedbackRetention(config);
          lastCleanup = Date.now();
        } catch {
          logger.warn(
            { code: 'feedback_retention_failed' },
            'Feedback retention cleanup will retry'
          );
        }
      }
      if (!stopped && (abandonedCursor || Date.now() - lastAbandonedScan > 3600000)) {
        abandonedCursor = await cleanupAbandonedFeedbackUploads(config, abandonedCursor);
        if (!abandonedCursor) lastAbandonedScan = Date.now();
      }
    } catch {
      logger.warn({ code: 'feedback_worker_failed' }, 'Feedback delivery or retention will retry');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          running = tick();
        }, 15000);
        timer.unref();
      }
    }
  };
  timer = setTimeout(() => {
    running = tick();
  }, 1000);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    }
  };
}
