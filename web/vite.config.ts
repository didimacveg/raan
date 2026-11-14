import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Base path. Nothing here names the repository:
// * on GitHub Pages the workflow passes BASE_PATH from actions/configure-pages (`/raan/` today,
//   and it follows any future rename on its own);
// * everywhere else (local dev, `vite preview`, Vercel, a file server) the build stays relative.
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw || raw === './') return './'
  return raw.endsWith('/') ? raw : `${raw}/`
}

export default defineConfig({
  base: basePath(),
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never)
