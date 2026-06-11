#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const allowlistPath = resolve(process.cwd(), 'deprecations-allowlist.json');
const lockfilePath = resolve(process.cwd(), 'package-lock.json');

function loadAllowlist(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Failed to read allowlist at ${path}: ${error.message}`);
    process.exit(2);
  }

  const exact = Array.isArray(parsed.exact) ? parsed.exact : [];
  const packages = Array.isArray(parsed.packages) ? parsed.packages : [];

  return {
    exact: new Set(exact),
    packages: new Set(packages),
  };
}

function runNpmLs() {
  const result = spawnSync('npm', ['ls', '--all', '--json'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });

  if (!result.stdout) {
    console.error('npm ls produced no JSON output.');
    process.exit(2);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error(`Failed to parse npm ls JSON output: ${error.message}`);
    process.exit(2);
  }
}

function collectDeprecatedFromNpmLs(tree) {
  const found = new Map();

  function visit(node, packageName, pathParts) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.deprecated && packageName) {
      const version = node.version || 'unknown';
      const key = `${packageName}@${version}`;
      if (!found.has(key)) {
        found.set(key, {
          packageName,
          version,
          message: node.deprecated,
          path: pathParts.join(' > '),
        });
      }
    }

    const deps = node.dependencies || {};
    for (const [childName, childNode] of Object.entries(deps)) {
      const childVersion = childNode && childNode.version ? childNode.version : 'unknown';
      visit(childNode, childName, [...pathParts, `${childName}@${childVersion}`]);
    }
  }

  visit(tree, tree.name || null, [tree.name || 'root']);
  return [...found.values()];
}

function collectDeprecatedFromLockfile(path) {
  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Failed to parse lockfile at ${path}: ${error.message}`);
    process.exit(2);
  }

  const packages = lockfile.packages;
  if (!packages || typeof packages !== 'object') {
    return [];
  }

  const found = new Map();

  for (const [packagePath, details] of Object.entries(packages)) {
    if (!details || typeof details !== 'object' || !details.deprecated) {
      continue;
    }

    const packageName = packagePath.startsWith('node_modules/')
      ? packagePath.slice('node_modules/'.length)
      : details.name;

    if (!packageName) {
      continue;
    }

    const version = details.version || 'unknown';
    const key = `${packageName}@${version}`;

    if (!found.has(key)) {
      found.set(key, {
        packageName,
        version,
        message: details.deprecated,
        path: packagePath || '(root package)',
      });
    }
  }

  return [...found.values()];
}

function collectDeprecated() {
  if (existsSync(lockfilePath)) {
    return collectDeprecatedFromLockfile(lockfilePath);
  }

  const depTree = runNpmLs();
  return collectDeprecatedFromNpmLs(depTree);
}

const allowlist = loadAllowlist(allowlistPath);
const deprecated = collectDeprecated();

const unexpected = deprecated.filter((entry) => {
  const exact = `${entry.packageName}@${entry.version}`;
  return !allowlist.exact.has(exact) && !allowlist.packages.has(entry.packageName);
});

if (unexpected.length > 0) {
  console.error('Unexpected deprecated dependencies found:');
  for (const entry of unexpected) {
    console.error(`- ${entry.packageName}@${entry.version}`);
    console.error(`  reason: ${entry.message}`);
    console.error(`  path:   ${entry.path}`);
  }
  console.error('\nAdd approved entries to frontend/deprecations-allowlist.json to allow these explicitly.');
  process.exit(1);
}

console.log(`Deprecation check passed. Found ${deprecated.length} deprecated package(s), all allowlisted.`);
