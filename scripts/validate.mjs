#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const skillNamePattern = /^[a-z0-9-]{1,64}$/;

async function main() {
  await validateMarketplace();
  await validatePlugin(repoRoot);

  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Validation passed.");
}

async function validateMarketplace() {
  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  const payload = await readJsonObject(marketplacePath);
  if (!payload) return;

  requireString(payload, "name", marketplacePath);

  if (payload.interface !== undefined && !isPlainObject(payload.interface)) {
    addError(marketplacePath, "interface must be an object");
  } else if (payload.interface !== undefined) {
    for (const field of ["icon", "logo"]) {
      if (payload.interface[field] !== undefined) {
        await validateRelativePath(
          path.dirname(marketplacePath),
          payload.interface[field],
          marketplacePath,
          `interface.${field}`,
        );
      }
    }
  }

  if (!Array.isArray(payload.plugins)) {
    addError(marketplacePath, "plugins must be an array");
    return;
  }

  for (const [index, entry] of payload.plugins.entries()) {
    const prefix = `plugins[${index}]`;
    if (!isPlainObject(entry)) {
      addError(marketplacePath, `${prefix}: entry must be an object`);
      continue;
    }

    const name = requireString(entry, "name", marketplacePath, prefix);
    if (!isPlainObject(entry.source)) {
      addError(marketplacePath, `${prefix}: source must be an object`);
      continue;
    }

    if (entry.source.source !== "local") {
      addError(marketplacePath, `${prefix}: source.source must be local`);
    }

    const sourcePath = requireString(entry.source, "path", marketplacePath, `${prefix}.source`);
    if (!sourcePath) continue;

    const pluginRoot = path.resolve(repoRoot, sourcePath);
    if (!isInside(repoRoot, pluginRoot)) {
      addError(marketplacePath, `${prefix}: source path escapes repository root`);
      continue;
    }

    const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
    if (!(await pathExists(manifestPath))) {
      addError(marketplacePath, `${prefix}: source path does not contain .codex-plugin/plugin.json`);
      continue;
    }

    const manifest = await readJsonObject(manifestPath);
    if (manifest && name && manifest.name !== name) {
      addError(marketplacePath, `${prefix}: marketplace name does not match plugin manifest name`);
    }
  }
}

async function validatePlugin(pluginRoot) {
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = await readJsonObject(manifestPath);
  if (!manifest) {
    addError(pluginRoot, "missing plugin manifest");
    return;
  }

  requireString(manifest, "name", manifestPath);
  const version = requireString(manifest, "version", manifestPath);
  if (version && !semverPattern.test(version)) {
    addError(manifestPath, "version must be semver");
  }

  requireString(manifest, "description", manifestPath);

  if (!isPlainObject(manifest.author) || !isNonEmptyString(manifest.author.name)) {
    addError(manifestPath, "author.name is required");
  }

  if (manifest.skills !== undefined) {
    await validateRelativePath(pluginRoot, manifest.skills, manifestPath, "skills");
  }

  if (!isPlainObject(manifest.interface)) {
    addError(manifestPath, "interface must be an object");
  } else {
    for (const field of [
      "displayName",
      "shortDescription",
      "longDescription",
      "developerName",
      "category",
    ]) {
      requireString(manifest.interface, field, manifestPath, "interface");
    }

    const defaultPrompt = manifest.interface.defaultPrompt ?? manifest.interface.default_prompt;
    if (!isNonEmptyString(defaultPrompt) && !Array.isArray(defaultPrompt)) {
      addError(manifestPath, "interface.defaultPrompt is required");
    }

    const capabilities = manifest.interface.capabilities ?? [];
    if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
      addError(manifestPath, "interface.capabilities must be an array of strings");
    }

    for (const field of ["composerIcon", "logo"]) {
      if (manifest.interface[field] !== undefined) {
        await validateRelativePath(pluginRoot, manifest.interface[field], manifestPath, `interface.${field}`);
      }
    }
  }

  const skillsRoot = path.join(pluginRoot, "skills");
  const skillDirs = await listDirectories(skillsRoot);
  for (const skillDir of skillDirs) {
    await validateSkill(path.join(skillDir, "SKILL.md"));
  }
}

async function validateSkill(skillPath) {
  const text = await readText(skillPath);
  if (text === null) return;

  const frontmatter = parseFrontmatter(skillPath, text);
  if (!frontmatter) return;

  const name = frontmatter.name;
  if (
    !isNonEmptyString(name) ||
    !skillNamePattern.test(name) ||
    name.startsWith("-") ||
    name.endsWith("-") ||
    name.includes("--")
  ) {
    addError(skillPath, "frontmatter name must be hyphen-case and <=64 chars");
  } else if (name !== path.basename(path.dirname(skillPath))) {
    addError(skillPath, "frontmatter name must match skill folder");
  }

  if (!isNonEmptyString(frontmatter.description)) {
    addError(skillPath, "frontmatter description is required");
  }
}

function parseFrontmatter(filePath, text) {
  if (!text.startsWith("---\n")) {
    addError(filePath, "missing YAML frontmatter");
    return null;
  }

  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    addError(filePath, "unterminated YAML frontmatter");
    return null;
  }

  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      addError(filePath, `unsupported frontmatter line: ${trimmed}`);
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return data;
}

async function validateRelativePath(root, rawPath, source, label) {
  if (!isNonEmptyString(rawPath) || !rawPath.startsWith("./")) {
    addError(source, `${label} must be a relative path starting with ./`);
    return;
  }

  const target = path.resolve(root, rawPath);
  if (!isInside(root, target)) {
    addError(source, `${label} escapes plugin root`);
    return;
  }

  if (!(await pathExists(target))) {
    addError(source, `${label} does not exist: ${rawPath}`);
  }
}

async function readJsonObject(filePath) {
  const text = await readText(filePath);
  if (text === null) return null;

  try {
    const payload = JSON.parse(text);
    if (!isPlainObject(payload)) {
      addError(filePath, "JSON root must be an object");
      return null;
    }
    return payload;
  } catch (error) {
    addError(filePath, `invalid JSON: ${error.message}`);
    return null;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    addError(filePath, `unable to read: ${error.message}`);
    return null;
  }
}

async function listDirectories(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch (error) {
    addError(root, `unable to read skills directory: ${error.message}`);
    return [];
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function requireString(payload, key, filePath, prefix) {
  const value = payload[key];
  const label = prefix ? `${prefix}.${key}` : key;
  if (!isNonEmptyString(value)) {
    addError(filePath, `${label} must be a non-empty string`);
    return null;
  }
  return value;
}

function addError(filePath, message) {
  errors.push(`${relativePath(filePath)}: ${message}`);
}

function relativePath(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)) || ".";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

await main();
