# Publishing Repolain

## 1. Verify the workspace

Run:

```bash
corepack pnpm release:check
```

This validates:

- TypeScript type checking
- package builds
- test suite
- publishable package packaging via workspace metadata

## 2. Authenticate npm

Run:

```bash
npm login
npm whoami
```

`npm whoami` must return your npm username before you attempt a real publish.

## 3. Create local installable tarballs

Create only the user-facing CLI tarball:

```bash
corepack pnpm pack:cli
```

Create tarballs for all publishable packages:

```bash
corepack pnpm pack:packages
```

The tarballs are written to:

```text
.artifacts/
```

## 4. Test local installation

Example:

```bash
npm install -g ./.artifacts/repolain-0.1.0.tgz
repolain --help
```

If you do not want a global install, you can also test with:

```bash
npx ./.artifacts/repolain-0.1.0.tgz --help
```

## 5. Dry-run the publish

Validate publish packaging without uploading:

```bash
corepack pnpm publish:dry-run
```

This is the safest way to confirm the monorepo publish order and workspace dependency rewriting.

## 6. Publish order

Because the CLI depends on workspace packages, publish in this order:

1. `@repolain/knowledge-base`
2. `@repolain/core`
3. `repolain`

Example workflow:

```bash
corepack pnpm --filter @repolain/knowledge-base publish --access public --no-git-checks
corepack pnpm --filter @repolain/core publish --access public --no-git-checks
corepack pnpm --filter repolain publish --access public --no-git-checks
```

Or use the root convenience script:

```bash
corepack pnpm publish:packages
```

## 7. Versioning guidance

For now, keep versions aligned across packages:

- `packages/knowledge-base/package.json`
- `packages/core/package.json`
- `packages/cli/package.json`

Before each public release:

- update the versions together
- rebuild
- rerun tests
- pack locally and verify install
- run the dry-run publish once

## 8. Package name checks

Before the first release, verify these names are available or already owned by you:

```bash
npm view repolain version
npm view @repolain/core version
npm view @repolain/knowledge-base version
```

If a package does not exist yet, npm will return a 404-style error. If it exists and is not yours, you need a different name.

## 9. Publish to GitHub

Push your current default branch to GitHub before publishing packages.

After the push succeeds, other users can:

- clone the source code from GitHub
- download ZIP archives from the repository page
- install a tarball or npm package if you publish one

If you want GitHub release assets, create a release and attach files from `.artifacts/`.

## 10. Current blockers to check manually

- npm account authentication on the publishing machine
- package name availability on the npm registry
- license choice for public distribution

`LICENSE` is now included in the repository and package metadata uses `MIT`.

## 11. Future growth

This structure is already compatible with adding:

- richer knowledge indexing
- VS Code extension package
- MCP server package
- more advanced LLM providers
- database migrations beyond the current SQLite schema

The current recommendation is:

- keep all product logic in `packages/core`
- let `packages/cli` stay thin
- add future delivery surfaces as separate packages
