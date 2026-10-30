/**
 * @fileoverview Playwright end-to-end configuration.
 *
 * - The app is built and served with `vite preview` on port 4173 (build output is streamed so a
 *   slow first start is visible instead of looking like a hang).
 * - The server uses its own throw-away SQLite database (`.data/e2e.db`), recreated before every
 *   run by the `webServer` command, so tests never touch real data and never see leftovers.
 * - A `setup` project signs in once and saves the session to `.data/e2e-auth.json`; the `chromium`
 *   project reuses it so individual tests start authenticated.
 */
import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
	testMatch: '**/*.e2e.{ts,js}',
	timeout: 30_000,
	retries: process.env.CI ? 2 : 0,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure'
	},
	webServer: {
		// The database is wiped here (not in a globalSetup, which runs after the server has started
		// and would delete files the server already holds open).
		command: `rm -f .data/e2e.db .data/e2e.db-wal .data/e2e.db-shm .data/e2e-auth.json && npm run build && npm run preview -- --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		timeout: 240_000,
		reuseExistingServer: false,
		stdout: 'pipe',
		stderr: 'pipe',
		env: { DB_CONFIG_PATH: '.data/e2e-missing.json', DATABASE_URL: '.data/e2e.db' }
	},
	projects: [
		{ name: 'setup', testMatch: 'e2e/auth.setup.ts' },
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], storageState: '.data/e2e-auth.json' },
			dependencies: ['setup']
		}
	]
});
