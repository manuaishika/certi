import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'

// Uses the Chromium that ships with the environment when present (PW_CHROMIUM overrides); otherwise Playwright's own.
function chromium(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d))
  const p = dir && `${root}/${dir}/chrome-linux64/chrome`
  return p && existsSync(p) ? p : (dir && existsSync(`${root}/${dir}/chrome-linux/chrome`) ? `${root}/${dir}/chrome-linux/chrome` : undefined)
}

export default defineConfig({
  testDir: 'e2e', timeout: 120_000, retries: 0, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 }, acceptDownloads: true,
    launchOptions: { executablePath: chromium(), args: ['--no-sandbox'] } },
  webServer: { command: 'npx vite preview --port 4173 --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 60_000 },
})
