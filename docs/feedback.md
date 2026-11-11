# TeacherOS feedback operations

The API and existing PostgreSQL database are the system of record. The teacher
opens Feedback without leaving their page; the owner uses `/management/feedback`.
Teachers cannot view submitted reports. The developer can add private notes and
update status from the inbox. Saving a report and creating its notification outbox
entry happen in one database transaction. Email availability
does not determine whether feedback saves successfully.

## Implementation map

| Feature                                                                          | Repository location                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Global panel and automatic screenshot capture                                   | `apps/web/src/components/FeedbackProvider.tsx`                          |
| Screenshot review, annotations and solid redaction                               | `apps/web/src/components/FeedbackImageEditor.tsx`                       |
| Bounded diagnostics and page-context registration                                | `apps/web/src/lib/feedbackDiagnostics.ts`                               |
| Owner inbox and teacher conversations                                            | `apps/web/src/pages/FeedbackPage.tsx`                                   |
| Authenticated submission, support authorization and private attachment streaming | `apps/api/src/routes/feedback.ts`                                       |
| Server diagnostic allowlists and validation                                      | `apps/api/src/services/feedback-sanitization.ts`                        |
| Durable email outbox, retries and retention                                      | `apps/api/src/services/feedback-delivery.ts`                            |
| Database schema and forward migration                                            | `packages/db/src/schema.ts`, `packages/db/migrations/0026_feedback.sql` |

The frontend uses the existing API client and Clerk provider. A signed-in user must
enter the developer inbox password, which the Fastify backend checks on every inbox
and attachment request. Reports are not exposed through teacher history endpoints.
The password is stored only for the current browser tab and can be overridden using
the server-only `FEEDBACK_INBOX_PASSWORD` environment variable.

## Environment and email setup

Copy the relevant names from `.env.feedback.example` into the API deployment's
environment; that file is a template and is not loaded automatically. Keep all
email credentials and S3 credentials server-side. Existing `DATABASE_URL`, Clerk,
and S3 settings continue to apply.

| Variable                      | Behavior                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`              | Server-side Resend sending key. Required to send email.                                                              |
| `FEEDBACK_EMAIL_FROM`         | Verified sender, for example `TeacherOS <support@your-verified-domain>`. No sender is invented by the application.   |
| `APP_PUBLIC_URL`              | Frontend origin used for authenticated report links. Set the actual HTTPS production URL.                            |
| `FEEDBACK_NOTIFICATION_EMAIL` | Owner notification recipient; defaults to `am@aidanmccormick.com`. This does not grant dashboard access.             |
| `FEEDBACK_EMAIL_ENABLED`      | Defaults to `true`. Set exactly `false` to pause delivery while feedback and the inbox continue working.             |
| `FEEDBACK_INBOX_PASSWORD`     | Optional server-only override for the temporary developer inbox password.                                            |
| `FEEDBACK_S3_BUCKET`          | Optional private attachment bucket. Screenshots fall back to PostgreSQL when unavailable.                           |
| `FEEDBACK_RETENTION_DAYS`     | Integer from 1 to 3650, default 90; applies to diagnostic details, screenshots, and completed notification metadata. |

Create a sending domain in Resend, add the DNS records shown by Resend, and wait
for verification before setting `FEEDBACK_EMAIL_FROM` to an address on that domain.
Create a sending API key and configure the server environment. The repository uses
the official `resend` server SDK; see the [Resend domain documentation](https://resend.com/docs/dashboard/domains/introduction)
and [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

Missing configuration or disabled email leaves durable entries in
`configuration_blocked`; no notification is reported as sent. Once configuration
is restored and the API is restarted, the worker resumes eligible entries.
Owner recipient overrides affect new outbox records; already queued records keep
their recorded recipient. Never use an email recipient setting as authorization.

## Migration and inbox access

Apply the normal forward migration path after taking the usual database backup:

```sh
npm --workspace @teacheros/db run db:migrate
npm --workspace @teacheros/db run build
```

These commands require the intended `DATABASE_URL` in the process environment.
Migration `packages/db/migrations/0026_feedback.sql` creates the feedback tables,
sequence, indexes, and `platform_support_users` grants. It does not reset data.
Review and apply to a disposable database before production. No production
migration or deployment is performed by implementing this feature.

Open `/management/feedback` while signed in and enter the temporary inbox
password. Set `FEEDBACK_INBOX_PASSWORD` on the API to replace the built-in
temporary password. Anyone with an application account and that password can
open the inbox, so share it only with people who should see all reports.
The legacy support-grant table is retained for compatibility and is not required
to unlock the inbox.

## Private attachment storage

Screenshots are captured automatically and included when the teacher sends feedback.
The description is optional and starts blank, including reports opened from an error.
Migration `0030_feedback_database_screenshots.sql` adds private PostgreSQL screenshot
storage. When object storage is absent or an upload fails, validated PNG bytes are
saved in `feedback_attachments.image_data`, with the same 5 MiB limit and private
inbox access as object-backed images. Database screenshots are deleted by retention
cleanup and cascade when their report is deleted.

To use the existing S3-compatible object storage:
Set `FEEDBACK_S3_BUCKET` to a dedicated private bucket. Configure existing
`S3_REGION`, `S3_ENDPOINT` (for non-AWS providers), `S3_FORCE_PATH_STYLE`,
`S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Give the API only the required
object read/write/delete permissions for that prefix. Block public access and
do not add a public bucket policy or public CDN mapping for feedback objects.

Attachments are uploaded through the authenticated API at explicit report
submission and downloaded through an authorized endpoint. Storage object keys
stay server-side. Screenshots require a teacher review; automatic masking cannot
guarantee removal of all private information. The teacher should remove student
details using the solid redaction tool before sending.

## Delivery, retry, and retention

Every running API process starts a lightweight PostgreSQL outbox worker outside
test mode. It polls every 15 seconds, processes at most 20 notifications per poll,
and claims rows with `FOR UPDATE SKIP LOCKED` and a two-minute lease. No extra
queue service is required. The API process must remain running for background
delivery and cleanup; a deployment that suspends all processes suspends work.

The worker freezes the email payload before sending, reuses a stable Resend
idempotency key, records the provider message ID only on acceptance, and retries
temporary failures up to six attempts with bounded backoff. `sent` means Resend
accepted the message, not a guarantee of mailbox delivery; investigate bounces
in the provider dashboard. Notification failure never rolls back a report.

The inbox shows notification status and offers an authorized retry. The API
endpoint is `POST /v1/management/feedback/:id/retry-notifications`, with the normal
authenticated bearer token. It retries failed or configuration-blocked entries,
never ones already marked sent. Check provider history before manually retrying
an ambiguous prior attempt: Resend keeps idempotency keys for 24 hours, so an
explicit replay after that window may produce a second email. Automatic delivery
stops ambiguous attempts after 23 hours and records
`delivery_outcome_requires_review` for an operator.

Once per hour, the same worker removes expired screenshot objects before
deleting their attachment rows, clears old diagnostic JSON and event rows, clears
expired email payload snapshots, and deletes completed notification metadata.
Object deletion failures leave attachment rows so cleanup can retry; storage
configuration must remain available for object cleanup. Written reports,
teacher replies, context identifiers, and administrative history remain with the
report. Open reports are not deleted. Authorized permanent report deletion in
the inbox removes stored objects and cascades related database data.

The worker also scans the dedicated private bucket's `feedback/` prefix for
abandoned uploads. It inspects at most 100 objects per poll, continues through
paginated results across polls, and starts another scan one hour after finishing.
Only generated UUID screenshot paths older than 24 hours without a matching
attachment record are deleted. Recent uploads, linked attachments, and unrelated
object prefixes are excluded. The API storage identity needs bucket list
permission restricted to this prefix in addition to object read/write/delete.

## Safe verification

For a real mail test, use a staging database, staging private bucket, a verified
sender, and a controlled destination in `FEEDBACK_NOTIFICATION_EMAIL`. Submit a
clearly labeled test report through the normal UI with synthetic content and no
student data. Confirm the saved reference appears in the owner inbox, wait for
the outbox status to change, check the configured destination and authenticated
report link, and add a developer-only note. Confirm no teacher-facing reply
notification is generated. Do not send ordinary automated tests to real recipients.

Before release, verify a teacher cannot read reports or attachments without the
inbox password, school administrators cannot access management without it, and an
unauthenticated request is rejected. Test the actual production private-bucket
policy by confirming anonymous reads fail. Submit a synthetic report after
deployment, inspect delivery state in the inbox, verify an authorized attachment
download, and confirm server logs contain no provider key or request payload.

Local focused email tests use a mocked provider and require no real email key:

```sh
npm --workspace @teacheros/api exec -- vitest run src/services/feedback-delivery.test.ts
```

For database isolation and authorization integration tests, first set
`FEEDBACK_TEST_DATABASE_URL` to a disposable PostgreSQL database URL and run:

```sh
DATABASE_URL="$FEEDBACK_TEST_DATABASE_URL" RUN_FEEDBACK_DB_TESTS=1 NODE_ENV=test npx --workspace @teacheros/api vitest run src/feedback.integration.test.ts
```

The integration suite applies the normal migrations to its test database. Do not
point it at production. The API workspace's general `npm test` script sets its own
localhost database URL, so use the explicit command above when selecting a
different disposable database.
