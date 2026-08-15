# Cloudflare Pages production releases

GitHub is the source of truth and Cloudflare Pages hosts the production frontend.

| Role | Canonical value |
| --- | --- |
| Repository | `aidanmccormick1/teacher-dashboard-clean` |
| Release branch | `main` |
| Pages project | `teacheros-app` |
| Production URL | `https://teacheros-app.pages.dev/management` |
| API host | `https://teacheros-api.onrender.com` |

The canonical Pages project is Git-connected to `aidanmccormick1/teacher-dashboard-clean`, with `main` as its only production branch. Direct release uploads are allowed only through the checked-in release command, which verifies GitHub `main`, runs the full quality gate, deploys the exact commit-tagged bundle, verifies the live bundle, and confirms API readiness.

## Release

1. Make an intentional Git commit on `main` in `teacher-dashboard-clean`.
2. Authenticate with `wrangler login` or export a Cloudflare API token with Pages edit access. Keep tokens out of Git.
3. Run:

```bash
npm run release:production
```

The command refuses the wrong checkout, wrong branch, dirty files, a non-canonical remote, or a local branch that does not exactly match `origin/main`. It records the Git SHA in the Cloudflare deployment and prints the matching Cloudflare deployment ID at completion.

`teacher-dashboard-clean.pages.dev` is a legacy address. Once the `teacheros-app` cutover is verified, it is retained only as a redirect to the canonical production URL. A future custom domain should be attached to `teacheros-app`; the Pages hostname remains the fallback.

The redirect-only legacy bundle is stored at `ops/legacy-pages-redirect/` and is deployed only to the legacy Pages project. It is not part of the canonical frontend build.

Required frontend build values remain:

- `VITE_API_BASE_URL=https://teacheros-api.onrender.com`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_SENTRY_DSN` (optional)
