
'use strict';

/**
 * getVersions.js - Fetch latest Minecraft Bedrock Dedicated Server version
 * (stable/retail) from the public links endpoint.
 *
 * Exports:
 *   - getLatestStableVersion({ retries=1, cooldownMs=15000 }): Promise<string>
 *   - getAllStableVersions(): Promise<Array<{version:string, major:number, minor:number, patch:number, build:number}>>
 *   - getLatestPreviewVersion({ retries=1, cooldownMs=15000 }): Promise<string>
 *   - getAllPreviewVersions(): Promise<Array<{version:string, major:number, minor:number, patch:number, build:number}>>
 *
 * CLI:
 *   node getVersions.js            # prints latest stable a.b.c
 *   node getVersions.js --json     # prints JSON with latest and list
 */

const ENDPOINT = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';

/**
 * Fetch JSON with minimal retry/backoff using global fetch
 */
async function fetchWithRetry(url, { retries = 1, cooldownMs = 15000, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, cooldownMs));
        continue;
      }
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('Unknown fetch error');
}

/**
 * Parse the service response into a list of unique versions.
 * We keep both preview and retail but mark preview; caller can filter.
 */
function parseLinksToVersions(json) {
  const links = json?.result?.links || [];
  const seen = new Set();
  const out = [];

  for (const item of links) {
    const versionLabel = item?.downloadType || '';
    const url = item?.downloadUrl || '';

    // We only care about server zips with 'server-<version>.zip'
    if (!url.endsWith('.zip') || !url.includes('server-1')) continue;

    const preview = /preview/i.test(versionLabel);
    const verStr = url.split('server-').pop().replace(/\.zip$/,''); // a.b.c.d

    // Split into numeric components, pad to 4 numbers
    const parts = verStr.split('.').map(n => parseInt(n, 10));
    if (parts.some(Number.isNaN) || parts.length < 3) continue;
    const [major, minor, patch, build = 0] = parts;

    if (seen.has(verStr)) continue;
    seen.add(verStr);
    out.push({ preview, version: verStr, major, minor, patch, build });
  }
  return out;
}

/**
 * Compare versions by a.b.c (ignore build for ranking retail output).
 */
function cmpABC(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // tie-breaker: higher build last
  return (a.build ?? 0) - (b.build ?? 0);
}

/**
 * Return all stable (non-preview) versions seen, sorted ascending.
 */
async function getAllStableVersions(opts = {}) {
  const json = await fetchWithRetry(ENDPOINT, opts);
  const all = parseLinksToVersions(json);
  const stable = all.filter(v => !v.preview);
  stable.sort(cmpABC);
  return stable;
}

/**
 * Return all preview versions seen, sorted ascending.
 */
async function getAllPreviewVersions(opts = {}) {
  const json = await fetchWithRetry(ENDPOINT, opts);
  const all = parseLinksToVersions(json);
  const preview = all.filter(v => !!v.preview);
  preview.sort(cmpABC);
  return preview;
}

/**
 * Get the latest stable version as a.b.c (drop .d build part).
 */
async function getLatestStableVersion(opts = {}) {
  const stable = await getAllStableVersions(opts);
  if (stable.length === 0) throw new Error('No stable versions found');
  const latest = stable[stable.length - 1];
  return `${latest.major}.${latest.minor}.${latest.patch}`;
}

/**
 * Get the latest preview version as a.b.c (drop .d build part).
 */
async function getLatestPreviewVersion(opts = {}) {
  const preview = await getAllPreviewVersions(opts);
  if (preview.length === 0) throw new Error('No preview versions found');
  const latest = preview[preview.length - 1];
  return `${latest.major}.${latest.minor}.${latest.patch}`;
}

// CLI
if (require.main === module) {
  (async () => {
    try {
      const argv = new Set(process.argv.slice(2));
      const usePreview = argv.has('--preview');

      if (argv.has('--json')) {
        if (usePreview) {
          const latest = await getLatestPreviewVersion();
          const list = await getAllPreviewVersions();
          console.log(JSON.stringify({ latest, list, preview: true }, null, 2));
        } else {
          const latest = await getLatestStableVersion();
          const list = await getAllStableVersions();
          console.log(JSON.stringify({ latest, list, preview: false }, null, 2));
        }
      } else {
        const latest = usePreview
          ? await getLatestPreviewVersion()
          : await getLatestStableVersion();
        console.log(latest);
      }
    } catch (err) {
      console.error(err?.message || String(err));
      process.exit(1);
    }
  })();
}

module.exports = { getLatestStableVersion, getAllStableVersions, getLatestPreviewVersion, getAllPreviewVersions, parseLinksToVersions };
