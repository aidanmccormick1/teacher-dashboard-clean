/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions inspect methods without invoking them. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@teacheros/db', () => ({ pool: { query: vi.fn() } }));
vi.mock('../lib/s3.js', () => ({ createS3Client: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: unknown) {}
  }
}));
vi.mock('resend', () => ({ Resend: class {} }));

import { pool } from '@teacheros/db';
import type { AppConfig } from '../config.js';
import { createS3Client } from '../lib/s3.js';

import {
  buildFeedbackEmail,
  cleanupAbandonedFeedbackUploads,
  cleanupFeedbackRetention,
  feedbackEmailConfigurationError,
  processFeedbackDelivery,
  type DeliveryStore,
  type FeedbackEmailProvider
} from './feedback-delivery.js';

const config = {
  FEEDBACK_EMAIL_ENABLED: true,
  RESEND_API_KEY: 'test-key',
  FEEDBACK_EMAIL_FROM: 'support@example.com',
  APP_PUBLIC_URL: 'https://teacher.example.com'
};
const report = {
  id: 'report-id',
  reference_number: 'FB-1001',
  category: 'bug',
  description: '<script>alert("private")</script>',
  expected_behavior: 'Saved',
  reproduction_steps: null,
  page_name: 'Year Plan',
  page_path: '/year-plan',
  sanitized_url: '/year-plan',
  context: { lesson_id: 'lesson-id' },
  diagnostics: {
    errors: [{ message: 'Operation failed', stack: 'private detailed stack trace' }],
    network: [{ status: 500 }]
  },
  app_version: '1.0',
  commit_sha: 'abc123',
  status: 'new',
  priority: 'normal',
  created_at: new Date('2026-11-02T01:00:00Z'),
  reporter_name: 'Teacher',
  reporter_email: 'teacher@example.com',
  school_name: 'School',
  attachment_count: '1',
  reply_message: 'Thanks, we fixed it.'
};
const delivery = {
  id: 'delivery-id',
  report_id: report.id,
  notification_type: 'new_report',
  recipient_identifier: 'owner@example.com',
  reply_id: null,
  attempt_count: 0,
  payload: null,
  created_at: new Date(),
  first_attempted_at: null
};
function mocks(overrides: Partial<typeof delivery> = {}) {
  const store: DeliveryStore = {
    claim: vi.fn().mockResolvedValue({ ...delivery, ...overrides }),
    report: vi.fn().mockResolvedValue(report),
    savePayload: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    defer: vi.fn().mockResolvedValue(undefined)
  };
  const provider: FeedbackEmailProvider = {
    send: vi.fn().mockResolvedValue({ id: 'provider-id' })
  };
  return { store, provider };
}

describe('feedback email templates', () => {
  it('escapes user HTML, includes private authenticated link, and uses the outbox recipient', () => {
    const email = buildFeedbackEmail(config, delivery, report);
    expect(email.to).toBe('owner@example.com');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.text).toContain('teacher@example.com');
    expect(email.text).toContain('https://teacher.example.com/management/feedback/report-id');
    expect(email.text).toContain('Available in the private report');
    expect(email.subject).toContain('BUG | Year Plan | FB-1001');
    expect(email.text).toContain('Operation failed');
    expect(email.text).not.toContain('private detailed stack trace');
  });

  it('keeps internal diagnostics and reporter identity out of teacher reply notifications', () => {
    const email = buildFeedbackEmail(
      config,
      { ...delivery, notification_type: 'teacher_reply' },
      report
    );
    expect(email.text).toContain('Thanks, we fixed it.');
    expect(email.text).toContain('https://teacher.example.com/feedback/report-id');
    expect(email.text).not.toContain('lesson-id');
    expect(email.text).not.toContain('Operation failed');
    expect(email.text).not.toContain('teacher@example.com');
  });
});

describe('abandoned feedback uploads', () => {
  const key = (id: number) =>
    `feedback/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-${String(id).padStart(12, '0')}.png`;

  it('only deletes old generated screenshot keys without a matching attachment record', async () => {
    const old = new Date(Date.now() - 25 * 3600000);
    const send = vi.fn().mockResolvedValue({});
    send.mockResolvedValueOnce({
      Contents: [
        { Key: key(1), LastModified: old },
        { Key: key(2), LastModified: old },
        { Key: key(3), LastModified: new Date() },
        { Key: 'feedback/unrelated-file.png', LastModified: old },
        { Key: 'materials/private.png', LastModified: old }
      ],
      IsTruncated: true,
      NextContinuationToken: 'page-2'
    });
    const destroy = vi.fn();
    vi.mocked(createS3Client).mockReturnValue({ send, destroy } as unknown as ReturnType<
      typeof createS3Client
    >);
    const query = vi.mocked(pool.query);
    query.mockReset();
    query.mockResolvedValue({ rows: [{ storage_object_path: key(2) }] } as never);
    expect(
      await cleanupAbandonedFeedbackUploads(
        { ...config, FEEDBACK_S3_BUCKET: 'private' } as AppConfig,
        'page-1'
      )
    ).toBe('page-2');
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: 'private',
      Prefix: 'feedback/',
      MaxKeys: 100,
      ContinuationToken: 'page-1'
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ANY($1::text[])'), [
      [key(1), key(2)]
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].input).toEqual({ Bucket: 'private', Key: key(1) });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not list or delete anything without the dedicated private bucket', async () => {
    const send = vi.fn();
    vi.mocked(createS3Client).mockReturnValue({ send } as unknown as ReturnType<
      typeof createS3Client
    >);
    expect(await cleanupAbandonedFeedbackUploads(config as AppConfig)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the storage client when a scan fails so the page can be retried', async () => {
    const destroy = vi.fn();
    vi.mocked(createS3Client).mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      destroy
    } as unknown as ReturnType<typeof createS3Client>);
    await expect(
      cleanupAbandonedFeedbackUploads({ ...config, FEEDBACK_S3_BUCKET: 'private' } as AppConfig)
    ).rejects.toThrow('storage unavailable');
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('feedback retention', () => {
  it('deletes the private object before deleting its attachment record', async () => {
    const send = vi.fn().mockResolvedValue({});
    const destroy = vi.fn();
    vi.mocked(createS3Client).mockReturnValue({ send, destroy } as unknown as ReturnType<
      typeof createS3Client
    >);
    const query = vi.mocked(pool.query);
    query.mockReset();
    query.mockResolvedValue({ rows: [] } as never);
    query.mockResolvedValueOnce({
      rows: [{ id: 'attachment', storage_object_path: 'feedback/report/file.png' }]
    } as never);
    await cleanupFeedbackRetention({
      ...config,
      FEEDBACK_RETENTION_DAYS: 90,
      FEEDBACK_S3_BUCKET: 'private'
    } as AppConfig);
    const deletion = query.mock.calls.findIndex(([sql]) =>
      String(sql).includes('DELETE FROM feedback_attachments')
    );
    expect(deletion).toBe(1);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[deletion]!
    );
    expect(destroy).toHaveBeenCalledOnce();
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM feedback_reports'))
    ).toBe(false);
  });

  it('retains the attachment record when storage deletion fails for a later retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const destroy = vi.fn();
    vi.mocked(createS3Client).mockReturnValue({ send, destroy } as unknown as ReturnType<
      typeof createS3Client
    >);
    const query = vi.mocked(pool.query);
    query.mockReset();
    query.mockResolvedValueOnce({
      rows: [{ id: 'attachment', storage_object_path: 'feedback/report/file.png' }]
    } as never);
    await expect(
      cleanupFeedbackRetention({
        ...config,
        FEEDBACK_RETENTION_DAYS: 90,
        FEEDBACK_S3_BUCKET: 'private'
      } as AppConfig)
    ).rejects.toThrow('feedback_retention_storage_failed');
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM feedback_attachments'))
    ).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET diagnostics='{}'"))).toBe(
      true
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('durable feedback email processing', () => {
  it('blocks delivery without configuration while preserving the outbox record', async () => {
    const { store, provider } = mocks();
    await processFeedbackDelivery({ ...config, RESEND_API_KEY: undefined }, store, provider);
    expect(store.defer).toHaveBeenCalledWith(
      delivery.id,
      'configuration_blocked',
      'email_configuration_missing',
      60
    );
    expect(provider.send).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(feedbackEmailConfigurationError({ ...config, FEEDBACK_EMAIL_ENABLED: false })).toBe(
      'email_disabled'
    );
  });

  it('persists the immutable payload before provider delivery and records acceptance', async () => {
    const { store, provider } = mocks();
    await processFeedbackDelivery(config, store, provider);
    expect(store.savePayload).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com' }),
      'teacheros-feedback/delivery-id'
    );
    expect(store.complete).toHaveBeenCalledWith(delivery.id, 'provider-id');
    const saveOrder = vi.mocked(store.savePayload).mock.invocationCallOrder[0]!;
    expect(saveOrder).toBeLessThan(vi.mocked(provider.send).mock.invocationCallOrder[0]!);
  });

  it('retries transport failures and ends attempts at the configured bound', async () => {
    const { store, provider } = mocks();
    vi.mocked(provider.send).mockRejectedValue(new Error('secret provider response'));
    await processFeedbackDelivery(config, store, provider);
    expect(store.defer).toHaveBeenCalledWith(
      delivery.id,
      'pending',
      'delivery_transport_error',
      60
    );
    expect(store.complete).not.toHaveBeenCalled();
    const final = mocks({ attempt_count: 5 });
    vi.mocked(final.provider.send).mockRejectedValue(new Error('private'));
    await processFeedbackDelivery(config, final.store, final.provider);
    expect(final.store.defer).toHaveBeenCalledWith(
      delivery.id,
      'failed',
      'delivery_transport_error',
      1920
    );
  });

  it('uses the exact saved payload and stable idempotency key during retries', async () => {
    const payload = buildFeedbackEmail(config, delivery, report);
    const { store, provider } = mocks();
    vi.mocked(store.claim).mockResolvedValue({ ...delivery, payload, attempt_count: 1 });
    await processFeedbackDelivery(config, store, provider);
    expect(store.report).not.toHaveBeenCalled();
    expect(store.savePayload).toHaveBeenCalledWith(delivery.id, payload);
    expect(provider.send).toHaveBeenCalledWith(payload, 'teacheros-feedback/delivery-id');
  });

  it('does not automatically resend ambiguous outcomes after provider idempotency expires', async () => {
    const { store, provider } = mocks();
    vi.mocked(store.claim).mockResolvedValue({
      ...delivery,
      first_attempted_at: new Date(Date.now() - 25 * 3600000),
      payload: buildFeedbackEmail(config, delivery, report)
    });
    await processFeedbackDelivery(config, store, provider);
    expect(provider.send).not.toHaveBeenCalled();
    expect(store.defer).toHaveBeenCalledWith(
      delivery.id,
      'failed',
      'delivery_outcome_requires_review',
      0
    );
  });

  it('does nothing when another worker already claimed all deliveries', async () => {
    const { store, provider } = mocks();
    vi.mocked(store.claim).mockResolvedValue(null);
    expect(await processFeedbackDelivery(config, store, provider)).toBe(false);
    expect(provider.send).not.toHaveBeenCalled();
  });
});
