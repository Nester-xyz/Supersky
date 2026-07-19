#!/usr/bin/env node
/**
 * Derive the extension version from a git tag and write it into package.json.
 *
 * WXT reads the manifest version from package.json, so rewriting it here is
 * enough to make `wxt build` / `wxt zip` produce a correctly versioned package.
 *
 * Usage:
 *   node scripts/set-version.mjs v1.2.3      # explicit tag
 *   node scripts/set-version.mjs             # falls back to $GITHUB_REF_NAME
 *   node scripts/set-version.mjs v1.2.3 --check   # validate only, no write
 *
 * Chrome manifest versions must be one to four dot-separated integers, each
 * between 0 and 65535, with no leading zeros. Semver prerelease and build
 * suffixes (-beta.1, +sha) are stripped from the manifest version but reported
 * so the workflow can decide to skip a store publish.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = join(ROOT, 'package.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const rawInput = args.find((a) => !a.startsWith('--')) ?? process.env.GITHUB_REF_NAME;

if (!rawInput) {
  fail('No version given. Pass a tag (e.g. v1.2.3) or set GITHUB_REF_NAME.');
}

// v1.2.3-beta.1+build  ->  tag=1.2.3-beta.1+build
const tag = rawInput.replace(/^v/, '');

// Split the numeric core from any prerelease / build metadata.
const match = tag.match(/^(\d+(?:\.\d+){0,3})(?:[-+](.+))?$/);
if (!match) {
  fail(
    `"${rawInput}" is not a usable version. Expected something like v1.2.3, ` +
      `v1.2.3.4, or v1.2.3-beta.1.`,
  );
}

const [, core, suffix] = match;
const parts = core.split('.');

for (const part of parts) {
  const n = Number(part);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    fail(`Version segment "${part}" is out of range. Chrome allows 0-65535 per segment.`);
  }
  if (part.length > 1 && part.startsWith('0')) {
    fail(`Version segment "${part}" has a leading zero, which Chrome rejects.`);
  }
}

const version = parts.join('.');
const isPrerelease = Boolean(suffix);

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const previous = pkg.version;

if (!checkOnly) {
  pkg.version = version;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

const verb = checkOnly ? 'would set' : 'set';
console.log(
  `${verb} version: ${previous} -> ${version}${isPrerelease ? ` (prerelease: ${suffix})` : ''}`,
);

if (isPrerelease) {
  console.log(
    'Note: prerelease suffixes are not valid in a Chrome manifest, so the ' +
      `manifest will read ${version}.`,
  );
}

// Expose results to later workflow steps.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nis_prerelease=${isPrerelease}\n`);
}

function fail(message) {
  console.error(`set-version: ${message}`);
  process.exit(1);
}
