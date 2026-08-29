// Rewrites `workspace:` dependency ranges in every publishable workspace
// package to the actual versions of their targets, in place.
//
// `nub publish` forwards `workspace:` specs to the registry verbatim, and a
// published manifest must never contain them. The release workflow runs this
// on the throwaway CI checkout right before publishing; never run it on a
// working tree you care about.

import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
    name?: string;
    version?: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

const DEP_FIELDS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
] as const;

function readManifest(path: string): PackageJson {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function resolveWorkspaceRange(range: string, depVersion: string): string {
    const rest = range.slice("workspace:".length);
    // Follow pnpm publish semantics: `workspace:*` pins the exact version,
    // `workspace:^` / `workspace:~` keep their range prefix.
    if (rest === "*" || rest === "") {
        return depVersion;
    }
    if (rest === "^" || rest === "~") {
        return `${rest}${depVersion}`;
    }
    throw new Error(`unsupported workspace range: ${range}`);
}

const root = process.cwd();
const rootManifest = readManifest(join(root, "package.json")) as PackageJson & {
    workspaces?: string[];
};
const manifestPaths = (rootManifest.workspaces ?? []).flatMap((pattern) =>
    globSync(`${pattern}/package.json`, { cwd: root }),
);

const versions = new Map<string, string>();
for (const path of manifestPaths) {
    const manifest = readManifest(join(root, path));
    if (manifest.name !== undefined && manifest.version !== undefined) {
        versions.set(manifest.name, manifest.version);
    }
}

let rewritten = 0;
for (const path of manifestPaths) {
    const absolutePath = join(root, path);
    const manifest = readManifest(absolutePath);
    if (manifest.private === true) {
        continue;
    }
    let dirty = false;
    for (const field of DEP_FIELDS) {
        const deps = manifest[field];
        if (deps === undefined) {
            continue;
        }
        for (const [dep, range] of Object.entries(deps)) {
            if (!range.startsWith("workspace:")) {
                continue;
            }
            const depVersion = versions.get(dep);
            if (depVersion === undefined) {
                throw new Error(`${manifest.name ?? path}: ${dep} is not a workspace package`);
            }
            const resolved = resolveWorkspaceRange(range, depVersion);
            console.log(`${path}: ${field}.${dep} ${range} -> ${resolved}`);
            deps[dep] = resolved;
            dirty = true;
        }
    }
    if (dirty) {
        writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 4)}\n`);
        rewritten += 1;
    }
}

console.log(`rewrote ${rewritten} manifest(s)`);
