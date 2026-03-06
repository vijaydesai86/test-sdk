/**
 * Shared runtime configuration constants for the web application.
 *
 * All environment-variable reads that are used in more than one module
 * live here so every module sees the same resolved value.
 */

/**
 * Directory where generated `.md` reports are saved.
 *
 * On Vercel the filesystem is read-only except for `/tmp`, so we default
 * to `/tmp/reports`.  Locally the `reports/` folder in the project root is
 * used.  Override with `REPORTS_DIR` env var in either environment.
 */
export const REPORTS_DIR =
  process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');
