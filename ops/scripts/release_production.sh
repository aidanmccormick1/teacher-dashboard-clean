#!/usr/bin/env bash
set -euo pipefail

# The only production release path for the TeacherDesk web app.
#
# Source of truth: GitHub main in a clean teacher-dashboard-clean checkout.
# Frontend host: teacher-dashboard-clean Cloudflare Pages project.
# Backend host: Render, which auto-deploys the same Git commit.

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-teacher-dashboard-clean}"
WEB_URL="${WEB_URL:-https://teacher-dashboard-clean.pages.dev}"
API_URL="${API_URL:-https://teacheros-api.onrender.com}"
EXPECTED_REMOTE="https://github.com/aidanmccormick1/teacher-dashboard-clean.git"

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

echo "Pushing verified commit $commit_sha..."
git push origin main

echo "Building the production web bundle..."
npm --workspace @teacheros/web run build
local_entry="$(rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' apps/web/dist/index.html | head -1)"
[[ -n "$local_entry" ]] || fail "Could not identify the built web entry bundle."

previous_entry="$(curl -fsSL --max-time 30 "$WEB_URL/management" | rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' | head -1 || true)"
commit_subject="$(git log -1 --format=%s)"

echo "Deploying $local_entry to Cloudflare Pages project $PROJECT_NAME..."
npm exec --yes --package wrangler@4 -- \
  wrangler pages deploy apps/web/dist \
  --project-name "$PROJECT_NAME" \
  --branch main \
  --commit-hash "$commit_sha" \
  --commit-message "$commit_subject" \
  --commit-dirty=false

deployments_json="$(npm exec --yes --package wrangler@4 -- \
  wrangler pages deployment list --project-name "$PROJECT_NAME" --environment production --json)"
deployment_id="$(printf '%s' "$deployments_json" | node -e '
  const fs = require("node:fs");
  const commit = process.argv[1];
  const deployments = JSON.parse(fs.readFileSync(0, "utf8"));
  const deployment = deployments.find(
    (item) => typeof item.Source === "string" && (item.Source === commit || commit.startsWith(item.Source))
  );
  if (!deployment) process.exit(1);
  process.stdout.write(deployment.Id);
' "$commit_sha")" || fail "Cloudflare did not report a deployment for $commit_sha."

live_entry="$(curl -fsSL --max-time 30 "$WEB_URL/management" | rg -o 'assets/index-[A-Za-z0-9_-]+\\.js' | head -1)"
[[ "$live_entry" == "$local_entry" ]] || fail "Live bundle ($live_entry) does not match built bundle ($local_entry)."

curl -fsS --max-time 30 "$API_URL/health/readiness" | node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(0, "utf8"));
  if (value.ok !== true) process.exit(1);
'

printf '\nProduction release complete\n'
printf '  Git commit:               %s\n' "$commit_sha"
printf '  Cloudflare deployment:    %s\n' "$deployment_id"
printf '  Production bundle:        %s\n' "$live_entry"
printf '  Previous bundle:          %s\n' "${previous_entry:-none}"
printf '  Frontend:                 %s/management\n' "$WEB_URL"
printf '  API readiness:            passed\n'
