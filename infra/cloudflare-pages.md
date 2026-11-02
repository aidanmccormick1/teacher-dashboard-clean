# Cloudflare Pages production releases

GitHub is the source of truth and Cloudflare Pages hosts the production frontend.

| Role           | Canonical value                            |
| -------------- | ------------------------------------------ |
| Repository     | `aidanmccormick1/teacher-dashboard-clean`  |
| Release branch | `main`                                     |
| Pages project  | `teacherplat`                              |
| Production URL | `https://teacherplat.pages.dev/management` |
| API host       | `https://teacheros-api.onrender.com`       |

The canonical Pages project is Git-connected to `aidanmccormick1/teacher-dashboard-clean`, with `main` as its only production branch. A push to `main` triggers the production build. The checked-in release command verifies that Git-connected deployment for the exact commit, compares its live bundle to a local production build, and confirms API readiness. It does not create a second, ad-hoc production deployment.

## Release

1. Make an intentional Git commit on `main` in `teacher-dashboard-clean`.
2. Authenticate with `wrangler login` or export a Cloudflare API token with Pages edit access. Keep tokens out of Git.
3. Run:

```bash
npm run release:production
```

The command requires `RENDER_API_KEY` from secure local or CI secret storage. It is never written to the repository or emitted in logs; it is used only to verify that `teacheros-api` is live on the exact `main` commit.

The command refuses the wrong checkout, wrong branch, dirty files, a non-canonical remote, or a local branch that does not exactly match `origin/main`. It records the Git SHA in the Cloudflare deployment and prints the matching Cloudflare deployment ID at completion.

`teacheros-app.pages.dev` and `teacher-dashboard-clean.pages.dev` are legacy addresses. On November 2, 2026, `teacheros-app.pages.dev` served the app directly, while `teacher-dashboard-clean.pages.dev` redirected to `teacheros-app.pages.dev`. Do not assume either address currently redirects to `teacherplat`. A future custom domain should be attached to `teacherplat`; the Pages hostname remains the fallback.

The proposed redirect-only legacy bundle is stored at `ops/legacy-pages-redirect/`. Its presence in the repository does not establish that it is deployed. It is not part of the canonical frontend build.

Required frontend build values remain:

- `VITE_API_BASE_URL=https://teacheros-api.onrender.com`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_SENTRY_DSN` (optional)
