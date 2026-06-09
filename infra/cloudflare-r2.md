# Cloudflare R2 storage setup

TeacherOS uses private S3-compatible object storage for uploaded materials. For the free pilot stack, use Cloudflare R2 instead of AWS S3.

## Target setup

- Provider: Cloudflare R2
- Bucket: `teacheros-materials`
- Public access: disabled
- Upload pattern: API creates short-lived signed upload URLs, then the browser uploads directly to R2
- Render service: `teacheros-api`

## 1. Create the bucket

If Wrangler returns Cloudflare error `10042`, open the Cloudflare dashboard and enable **R2 Object Storage** for the account first. Bucket creation cannot work until that account-level R2 toggle is completed.

Use Wrangler from the repository root:

```bash
npx wrangler r2 bucket create teacheros-materials
```

If the bucket already exists, keep using it.

## 2. Create bucket-scoped R2 credentials

In Cloudflare:

1. Open **R2 Object Storage**.
2. Open **Manage R2 API Tokens**.
3. Create an API token with **Object Read & Write** permission.
4. Scope it only to the `teacheros-materials` bucket.
5. Copy the Access Key ID, Secret Access Key, and S3 endpoint URL.

The endpoint should look like:

```text
https://<cloudflare-account-id>.r2.cloudflarestorage.com
```

Do not make the bucket public. TeacherOS only needs signed uploads.

## 3. Set Render environment variables

Set these on the `teacheros-api` Render service:

```bash
S3_BUCKET=teacheros-materials
S3_REGION=auto
S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=<r2-access-key-id>
S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
```

Then redeploy the Render service.

## 4. Verify storage is live

Health capability check:

```bash
curl -fsS https://teacheros-api.onrender.com/health/capabilities
```

Expected storage result:

```json
{
  "s3": true
}
```

Run the full smoke test with a real signed upload:

```bash
PILOT_TOKEN=teacher-dashboard-pilot-2026 \
SMOKE_S3_UPLOAD=1 \
npm run ops:smoke:production
```

The smoke script requests a signed URL from `POST /v1/files/sign-upload` and uploads a tiny text file to R2.

## Local backup and restore

The S3 backup scripts support R2 when `S3_ENDPOINT` is set:

```bash
export S3_BUCKET=teacheros-materials
export S3_REGION=auto
export S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
export S3_ACCESS_KEY_ID=<r2-access-key-id>
export S3_SECRET_ACCESS_KEY=<r2-secret-access-key>

npm run ops:backup:s3
```

Use `npm run ops:restore:s3 -- <local-folder>` to restore material objects.
