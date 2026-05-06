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

## 2. Create local installable tarballs

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

## 3. Test local installation

Example:

```bash
npm install -g ./.artifacts/repolain-0.1.0.tgz
repolain --help
```

If you do not want a global install, you can also test with:

```bash
npx ./.artifacts/repolain-0.1.0.tgz --help
```

## 4. Publish order

Because the CLI depends on workspace packages, publish in this order:

1. `@repolain/knowledge-base`
2. `@repolain/core`
3. `repolain`

Example workflow:

```bash
cd packages/knowledge-base
npm publish --access public

cd ../core
npm publish --access public

cd ../cli
npm publish
```

## 5. Versioning guidance

For now, keep versions aligned across packages:

- `packages/knowledge-base/package.json`
- `packages/core/package.json`
- `packages/cli/package.json`

Before each public release:

- update the versions together
- rebuild
- rerun tests
- pack locally and verify install

## 6. Publish to GitHub

This repository does not currently have a GitHub remote configured. To publish it:

```bash
git remote add origin git@github.com:<your-account>/repolain.git
git branch -M main
git add .
git commit -m "Initial Repolain release"
git push -u origin main
```

After the push succeeds, other users can:

- clone the source code from GitHub
- download ZIP archives from the repository page
- install a tarball or npm package if you publish one

If you want GitHub release assets, create a release and attach files from `.artifacts/`.

## 7. Future growth

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
