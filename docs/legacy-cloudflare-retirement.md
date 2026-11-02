# Legacy Cloudflare Pages retirement plan

The repository identifies `teacherplat.pages.dev` as the canonical production
frontend and `teacheros-app.pages.dev` as a legacy transition address. The
legacy address is still reachable, so do not delete its project or change its
behavior without checking actual traffic and dependencies first. On November 2,
2026, a request to `teacheros-app.pages.dev/sharing?test=1` returned the app
directly (HTTP 200), while `teacher-dashboard-clean.pages.dev` returned an
HTTP 302 redirect to `teacheros-app.pages.dev`. This does not establish actual
usage, but it does show that removing the latter project could break both URLs.

1. In Cloudflare, identify the Pages projects, their connected repositories,
   production branches, custom domains, deployment histories, and current
   redirects. Confirm which deployment currently serves each hostname.
2. Verify `teacherplat` serves the intended production release from `main` and
   that login, sharing links, the API, and important teacher workflows work.
3. Inventory links and integrations using `teacheros-app.pages.dev`, including
   Clerk allowed origins, API CORS, email templates, bookmarks, custom domains,
   and any third-party links. Update controlled references to the canonical URL.
4. Check traffic to the legacy hostname over an agreed observation period.
   Preserve a redirect for existing links; the repository's redirect-only
   bundle is `ops/legacy-pages-redirect/_redirects`. Test nested paths and query
   strings, especially shared lesson and curriculum links, before relying on it.
5. Record project settings and a rollback procedure. Decide whether the legacy
   Pages project must remain as the redirect host or whether another verified
   Cloudflare redirect can preserve the hostname. A deleted `pages.dev` project
   cannot be assumed to keep serving redirects or to be recoverable.
6. After the owner approves the concrete retirement plan, remove only the
   verified unused resources, then recheck both hostnames and API authentication.

This plan does not authorize deployment, redirect changes, or deletion. Cloudflare
dashboard access and live traffic/deployment verification are required to complete it.
