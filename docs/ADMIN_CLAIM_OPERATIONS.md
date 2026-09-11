# Administrator claim operations

The administrator claim flow is intentionally manual for the first release.
Claiming an existing school never creates a replacement school or changes its
school ID, teachers, courses, curriculum, schedule, or history.

Legacy profile roles are not treated as verified claims during migration.
Migration `0021_admin_foundation.sql` backfills memberships as teachers and
leaves schools unclaimed so every administrator receives the same review path.

## Review flow

1. The requester must already belong to the target school as an active member.
2. The requester submits `POST /v1/admin/claims` with the school ID, school
   email, position, and optional verification notes.
3. An authorized reviewer confirms the request outside the product using the
   supplied school email and position information.
4. The reviewer sends `POST /v1/admin/claims/:claimId/review` with
   `{ "status": "approved" }` or `{ "status": "rejected" }`.
5. Approval marks the existing school as claimed, creates the requester’s
   active administrator membership, and updates the legacy profile role. A
   rejection changes no permissions.

For an operational reviewer account, the endpoint accepts the normal
authenticated request. A separately managed `ADMIN_CLAIM_REVIEW_TOKEN` may be
configured for a controlled internal review tool and passed as the
`x-admin-claim-review-token` header, but only authenticated principals listed in
`ADMIN_CLAIM_REVIEWER_EMAILS` may use it. Store the token and allowlist only in
the deployment secret manager; never put them in the browser or repository.

The review endpoint rejects already-reviewed requests and refuses to approve a
competing request after the school has already been claimed. Pending requests
do not grant administrator access.

## Local administrator workspace testing

The production claim boundary remains manual. For local testing only, start the
API with `NODE_ENV=development` and `DEV_AUTH_ENABLED=true`, and start the web
app with `VITE_ENABLE_DEV_AUTH=true`. After completing a local teacher profile,
the Profile page exposes `Enable administrator test mode`.

The control requires an explicit browser confirmation and calls
`POST /v1/dev/admin-role` with the exact confirmation `ADMINISTRATOR`. It updates
only the current user's active local membership and profile role. It does not
claim the school, delete classes, change course ownership, or bypass the
production claim-review endpoint. The control can return an unclaimed local
school to teacher mode with the exact confirmation `TEACHER`.

This route is unavailable in production and accepts only local development
sessions. Use the normal claim request and review flow for any real school.

## Migration preflight

Migration `0024_one_course_owner.sql` intentionally stops if legacy data has
more than one owner for a course. Before retrying that migration, inspect the
conflicts with:

```sql
SELECT course_id, array_agg(user_id ORDER BY created_at) AS owner_ids
FROM course_collaborators
WHERE role = 'owner'
GROUP BY course_id
HAVING count(*) > 1;
```

An authorized operator must confirm the accountable owner for each returned
course, demote the other owner rows to `editor`, and then rerun the migration.
Keep that decision in the deployment record; the migration does not guess.

## Curriculum administration boundary

The administrator curriculum page is intentionally read-only and links to the
school-scoped course detail view. Teacher-owned curriculum stays attributed to
its owner; editing, duplicating, archiving, or featuring a teacher’s source
record remains in the existing teacher sharing workflow rather than becoming
an administrator impersonation capability.
