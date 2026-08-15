# Cloudflare Pages production releases

GitHub is the source of truth and Cloudflare Pages hosts the production frontend.

| Role | Canonical value |
| --- | --- |
| Repository | `aidanmccormick1/teacher-dashboard-clean` |
| Release branch | `main` |
| Pages project | `teacher-dashboard-clean` |
| Production URL | `https://teacher-dashboard-clean.pages.dev/management` |
| API host | `https://teacheros-api.onrender.com` |

The current Pages project is a Direct Upload project, so it cannot be attached to Cloudflare's Git integration in place. Do not upload ad-hoc bundles. Use the checked-in release command, which verifies GitHub `main`, runs the full quality gate, deploys the exact commit-tagged bundle, verifies the live bundle, and confirms API readiness.

## Release

1. Make an intentional Git commit on `main` in `teacher-dashboard-clean`.
2. Authenticate with `wrangler login` or export a Cloudflare API token with Pages edit access. Keep tokens out of Git.
3. Run:

```bash
npm run release:production
```

The command refuses the wrong checkout, wrong branch, dirty files, a non-canonical remote, or a local branch that does not exactly match `origin/main`. It records the Git SHA in the Cloudflare deployment and prints the matching Cloudflare deployment ID at completion.

Required frontend build values remain:

- `VITE_API_BASE_URL=https://teacheros-api.onrender.com`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_SENTRY_DSN` (optional)
