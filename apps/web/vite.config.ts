import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';

function commitSha() {
  if (process.env.CF_PAGES_COMMIT_SHA || process.env.RENDER_GIT_COMMIT)
    return process.env.CF_PAGES_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env.VITE_APP_VERSION ?? process.env.npm_package_version ?? 'development'
    ),
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(process.env.VITE_COMMIT_SHA ?? commitSha()),
    'import.meta.env.VITE_DEPLOYMENT_ID': JSON.stringify(
      process.env.VITE_DEPLOYMENT_ID ??
        process.env.CF_PAGES_BRANCH ??
        process.env.RENDER_SERVICE_ID ??
        ''
    )
  },
  server: {
    port: 5173
  }
});
