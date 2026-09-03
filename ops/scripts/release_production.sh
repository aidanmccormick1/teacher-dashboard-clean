#!/usr/bin/env bash
set -euo pipefail

# The only production release path for the TeacherDesk web app.
#
# Source of truth: GitHub main in a clean teacher-dashboard-clean checkout.
# Frontend host: Git-connected teacherplat Cloudflare Pages project.
# Backend host: Render, which auto-deploys the same Git commit.

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-teacherplat}"
WEB_URL="${WEB_URL:-https://teacherplat.pages.dev}"
API_URL="${API_URL:-https://teacheros-api.onrender.com}"
EXPECTED_REMOTE="https://github.com/aidanmccormick1/teacher-dashboard-clean.git"
RENDER_SERVICE="${RENDER_SERVICE:-teacheros-api}"
RENDER_SERVICE_ID="${RENDER_SERVICE_ID:-srv-d86hm157vvec73a83tc0}"
DEPLOYMENT_TIMEOUT_SECONDS="${DEPLOYMENT_TIMEOUT_SECONDS:-300}"

fail() {
  echo "Release blocked: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_command git
require_command npm
require_command curl
require_command node
[[ -n "${RENDER_API_KEY:-}" ]] || fail "Set RENDER_API_KEY in secure local/CI environment storage so the release can verify Render's exact deployment commit."

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this from teacher-dashboard-clean."
cd "$repo_root"

repo_name="$(basename "$repo_root")"
[[ "$repo_name" == "teacher-dashboard-clean" ]] || fail "Expected teacher-dashboard-clean, found $repo_name."
[[ "$(git branch --show-current)" == "main" ]] || fail "Production releases must run from main."
[[ "$(git remote get-url origin)" == "$EXPECTED_REMOTE" ]] || fail "origin is not the canonical GitHub repository."
git diff --quiet || fail "Working tree has unstaged changes. Commit or stash them first."
git diff --cached --quiet || fail "Working tree has staged changes. Commit or unstage them first."

echo "Checking Cloudflare authentication..."
npm exec --yes --package wrangler@4 -- wrangler whoami >/dev/null || \
  fail "Authenticate with wrangler login or set CLOUDFLARE_API_TOKEN with Cloudflare Pages edit access."

echo "Checking canonical main..."
git fetch origin main --quiet
commit_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
[[ "$commit_sha" == "$origin_sha" ]] || fail "Local main is not identical to origin/main. Push or fast-forward first."

echo "Running quality checks..."
npm run typecheck
npm run lint
npm run test
npm run build

echo "Building the production web bundle for comparison..."
npm --workspace @teacheros/web run build
local_entry="$(rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' apps/web/dist/index.html | head -1)"
[[ -n "$local_entry" ]] || fail "Could not identify the built web entry bundle."

previous_entry="$(curl -fsSL --max-time 30 "$WEB_URL/management" | rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' | head -1 || true)"

find_cloudflare_deployment() {
  npm exec --yes --package wrangler@4 -- \
    wrangler pages deployment list --project-name "$PROJECT_NAME" --environment production --json | \
    node -e '
  const fs = require("node:fs");
  const commit = process.argv[1];
  const deployments = JSON.parse(fs.readFileSync(0, "utf8"));
  const deployment = deployments.find(
    (item) => typeof item.Source === "string" && (item.Source === commit || commit.startsWith(item.Source))
  );
  if (!deployment) process.exit(1);
  process.stdout.write(deployment.Id);
' "$commit_sha"
}

echo "Waiting for the Git-connected main deployment on $PROJECT_NAME..."
deployment_id=""
for ((elapsed = 0; elapsed < DEPLOYMENT_TIMEOUT_SECONDS; elapsed += 5)); do
  deployment_id="$(find_cloudflare_deployment 2>/dev/null || true)"
  [[ -n "$deployment_id" ]] && break
  sleep 5
done
[[ -n "$deployment_id" ]] || fail "Cloudflare did not report a production main deployment for $commit_sha within ${DEPLOYMENT_TIMEOUT_SECONDS}s."

find_render_deployment() {
  curl -fsSL --max-time 30 \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Accept: application/json" \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys?limit=20" | \
    node -e '
  const fs = require("node:fs");
  const commit = process.argv[1];
  const deploys = JSON.parse(fs.readFileSync(0, "utf8"));
  const match = deploys
    .map((entry) => entry.deploy ?? entry)
    .find((deploy) => deploy?.commit?.id === commit && deploy.status === "live");
  if (!match) process.exit(1);
  process.stdout.write(match.id);
' "$commit_sha"
}

echo "Waiting for Render to serve the same main commit..."
render_deployment_id=""
for ((elapsed = 0; elapsed < DEPLOYMENT_TIMEOUT_SECONDS; elapsed += 5)); do
  render_deployment_id="$(find_render_deployment 2>/dev/null || true)"
  [[ -n "$render_deployment_id" ]] && break
  sleep 5
done
[[ -n "$render_deployment_id" ]] || fail "Render did not report a live deployment for $commit_sha within ${DEPLOYMENT_TIMEOUT_SECONDS}s."

live_entry="$(curl -fsSL --max-time 30 "$WEB_URL/management" | rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' | head -1)"
[[ "$live_entry" == "$local_entry" ]] || fail "Live bundle ($live_entry) does not match built bundle ($local_entry)."

curl -fsS --max-time 30 "$API_URL/health/readiness" | node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(0, "utf8"));
  if (value.ok !== true) process.exit(1);
'

WEB_URL="$WEB_URL" API_URL="$API_URL" npm run ops:smoke:production

printf '\nProduction release successful\n\n'
printf 'Repository:                 aidanmccormick1/teacher-dashboard-clean\n'
printf 'Branch:                     main\n'
printf 'Git SHA:                    %s\n' "$commit_sha"
printf 'Cloudflare project:         %s\n' "$PROJECT_NAME"
printf 'Cloudflare deployment:      %s\n' "$deployment_id"
printf 'Frontend:                   %s/management\n' "$WEB_URL"
printf 'Frontend bundle:            %s (verified)\n' "$live_entry"
printf 'Previous bundle:            %s\n' "${previous_entry:-none}"
printf 'Render service:             %s (main auto-deploy enabled)\n' "$RENDER_SERVICE"
printf 'Render deployment:          %s (%s, verified)\n' "$render_deployment_id" "$commit_sha"
printf 'API readiness:              passed\n'
printf 'Production smoke test:      passed\n'
printf 'Working tree:               clean\n'
