# Publishing Repolain

## 中文

## 1. 验证工作区

执行：

```bash
corepack pnpm release:check
```

这会验证：

- TypeScript 类型检查
- 各包构建
- 测试套件
- workspace 元数据下的可发布打包链路

## 2. 登录 npm

执行：

```bash
npm login
npm whoami
```

在正式发布前，`npm whoami` 必须返回你的 npm 用户名。

## 3. 生成本地安装包

只生成面向用户的 CLI tarball：

```bash
corepack pnpm pack:cli
```

生成全部可发布包：

```bash
corepack pnpm pack:packages
```

生成结果位于：

```text
.artifacts/
```

## 4. 验证本地安装

示例：

```bash
npm install -g ./.artifacts/repolain-0.1.0.tgz
repolain --help
```

如果不想全局安装，也可以执行：

```bash
npx ./.artifacts/repolain-0.1.0.tgz --help
```

## 5. 发布前 dry-run

在不真正上传的情况下验证发布流程：

```bash
corepack pnpm publish:dry-run
```

这是确认 monorepo 发布顺序和 workspace 依赖改写是否正常的最安全方式。

## 6. 发布顺序

由于 CLI 依赖 workspace 包，发布顺序应为：

1. `@repolain/knowledge-base`
2. `@repolain/core`
3. `repolain`

示例流程：

```bash
corepack pnpm --filter @repolain/knowledge-base publish --access public --no-git-checks
corepack pnpm --filter @repolain/core publish --access public --no-git-checks
corepack pnpm --filter repolain publish --access public --no-git-checks
```

也可以直接使用根脚本：

```bash
corepack pnpm publish:packages
```

## 7. 版本策略

目前建议三个包的版本保持一致：

- `packages/knowledge-base/package.json`
- `packages/core/package.json`
- `packages/cli/package.json`

每次公开发布前：

- 同步更新版本号
- 重新构建
- 重新跑测试
- 本地打包并验证安装
- 至少执行一次 dry-run publish

## 8. 包名检查

首次发布前，检查这些包名是否可用或是否已经归你所有：

```bash
npm view repolain version
npm view @repolain/core version
npm view @repolain/knowledge-base version
```

如果包不存在，npm 会返回类似 404 的错误；如果已存在但不属于你，你需要更换包名。

## 9. 发布到 GitHub

在发布 npm 包前，先把当前默认分支推送到 GitHub。

推送完成后，其他用户可以：

- 从 GitHub 克隆源码
- 从仓库页面下载 ZIP
- 通过 tarball 或 npm 包安装

如果你希望提供 GitHub Release 附件，可以把 `.artifacts/` 中的文件上传到 Release 页面。

## 10. 仍需手动确认的事项

- 发布机器上的 npm 认证状态
- npm registry 上的包名可用性
- 公开分发所使用的许可证

仓库现在已经包含 `LICENSE`，package metadata 使用的是 `MIT`。

## 11. 后续扩展

当前结构已经兼容后续新增：

- 更强的知识索引能力
- VS Code 扩展包
- MCP server 包
- 更多 LLM provider
- 更进一步的数据库 migration

当前建议仍然是：

- 所有产品核心逻辑放在 `packages/core`
- `packages/cli` 保持薄层
- 未来的新交付形态作为独立 package 增加

## English

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
