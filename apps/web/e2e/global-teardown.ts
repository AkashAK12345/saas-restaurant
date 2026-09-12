import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Fails the run if any of its secrets reached an artifact.
 *
 * Traces and videos are off, but a screenshot, an error context file or a
 * future reporter could still capture something. Every file the run left
 * behind is searched for the staff password, the API token secret and each
 * display credential (whole, and its secret half alone). The secrets
 * themselves are never printed — only the offending paths.
 */
export default async function globalTeardown(): Promise<void> {
  const secrets = new Set<string>();
  const add = (value: string | undefined) => {
    if (value && value.length >= 16) secrets.add(value);
  };
  add(process.env.SAMCO_E2E_PASSWORD);
  add(process.env.SAMCO_E2E_ACCESS_TOKEN_SECRET);
  const devices = process.env.SAMCO_E2E_DEVICES;
  if (devices) {
    for (const credential of Object.values(JSON.parse(devices) as Record<string, string>)) {
      add(credential);
      add(credential.split('.')[1]);
    }
  }

  const webDir = path.resolve(__dirname, '..');
  const leaks: string[] = [];
  const visit = (file: string) => {
    if (statSync(file).isDirectory()) {
      for (const entry of readdirSync(file)) visit(path.join(file, entry));
      return;
    }
    const content = readFileSync(file);
    for (const secret of secrets) {
      if (content.includes(secret)) {
        leaks.push(path.relative(webDir, file));
        return;
      }
    }
  };
  for (const dir of ['test-results', 'playwright-report', 'blob-report']) {
    const full = path.join(webDir, dir);
    if (existsSync(full)) visit(full);
  }

  if (leaks.length > 0) {
    throw new Error(
      `[browser-e2e] A run secret was found in ${leaks.length} artifact file(s): ${leaks.join(', ')}. ` +
        'Delete them and do not share them.',
    );
  }
}
