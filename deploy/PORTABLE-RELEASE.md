# WebClaw 便携发布说明

## 目标形态

发布包尽量收敛到最少外部文件：

```text
webclaw/
├── webclaw-server            # macOS / Linux 可执行文件
├── webclaw-server.exe        # Windows 可执行文件
├── .env
└── .ZxhClaw/
    ├── skills/
    ├── system-prompt/
    ├── sessions/v3/
    ├── artifacts/docs/
    └── memory/
```

其中：

- 默认前端静态资源会被打进 `runtime-bundle`
- 默认技能会被打进 `runtime-bundle`
- `.ZxhClaw/skills/` 用于部署后继续新增或覆盖技能
- `.ZxhClaw/system-prompt/` 用于覆写默认 prompt 模板

## 当前仓库里的构建结果

执行：

```bash
pnpm build
```

会按顺序完成：

1. 构建 shared
2. 构建 frontend
3. 生成 `backend/runtime-bundle.json`
4. 构建 backend

`backend/runtime-bundle.json` 是便携包和单文件可执行的共同资源输入。

## 跨平台产物说明

一个 `.exe` 不能直接在 Linux 或 macOS 原生运行。

要适配你的三类部署环境，需要分别产出：

- `webclaw-macos-arm64`
- `webclaw-linux-arm64`
- `webclaw-server.exe`

如果未来还要兼容传统 `x64 Linux` 或 `Windows arm64`，也要分别再出对应产物。

## 推荐发布路线

### 路线 A：便携 Node 包

适合先快速验证部署流程：

- 包含 `backend/dist/`
- 包含 `backend/runtime-bundle.json`
- 包含运行时依赖
- 通过 `node backend/dist/server.js` 启动

优点：

- 最容易落地
- 不依赖单文件可执行打包链

缺点：

- 目标机仍需要 Node，或者你要额外打包 Node 运行时

### 路线 B：单文件可执行（推荐最终形态）

适合正式交付：

- 使用 Node SEA 为每个平台分别构建
- 把 `runtime-bundle.json` 注入可执行文件
- 外部只保留 `.env` 与 `.ZxhClaw/`

优点：

- 文件最少
- 更接近“一键运行”
- 默认资源不再散落成一堆外部文件

缺点：

- 需要在对应平台或 CI 矩阵上分别构建

当前仓库已接入的命令：

```bash
pnpm build:sea:macos-arm64
pnpm build:sea:linux-arm64
pnpm build:sea:windows
```

产物默认输出到：

```text
release/sea/
├── macos-arm64/
├── linux-arm64/
└── windows-x64/
```

其中 Windows 命令当前默认构建 `x64` 版本。

## 技能目录约定

运行时技能来源按优先级合并：

1. 程序内置 bundle
2. 仓库内 `backend/skills/`（开发期）
3. 部署目录 `.ZxhClaw/skills/`（运行时覆盖）

因此：

- 开发默认技能时，继续放 `backend/skills/`
- 发布后追加技能时，放 `.ZxhClaw/skills/`
- 同名技能时，`.ZxhClaw/skills/` 会覆盖内置版本
