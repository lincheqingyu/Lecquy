# ZxhClaw

WebClaw / Agent Web 项目根目录说明。

## 目录约定

### 代码工作区

- `frontend/`：前端应用
- `backend/`：后端服务
- `shared/`：前后端共享类型
- `docs/`：项目文档

### AI 工作区：`.ZxhClaw/`

`.ZxhClaw/` 是 AI 运行时上下文与产物目录，不替代项目根目录本身的代码工作区。

当前规范如下：

```text
.ZxhClaw/
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── MEMORY.md
├── AGENTS.md
├── TOOLS.md
├── memory/
│   └── config.json
├── sessions/
│   └── v3/
│       ├── sessions.json
│       └── sessions/
├── artifacts/
│   └── docs/
└── system-prompt/
    ├── identity-simple.md
    ├── identity-manager.md
    ├── identity-worker.md
    ├── role-simple.md
    ├── role-manager.md
    ├── role-worker.md
    ├── tooling.md
    ├── tool-call-style.md
    ├── safety.md
    ├── skills.md
    ├── workspace.md
    ├── documentation.md
    ├── time.md
    ├── runtime.md
    └── extra-instructions.md
```

职责说明：

- `.ZxhClaw/SOUL.md`：助手气质与表达风格
- `.ZxhClaw/IDENTITY.md`：角色定位、边界与核心原则
- `.ZxhClaw/USER.md`：用户偏好、背景与长期约定
- `.ZxhClaw/MEMORY.md`：长期记忆主文件
- `.ZxhClaw/AGENTS.md`：系统托管运行规范
- `.ZxhClaw/TOOLS.md`：系统托管工具环境说明
- `.ZxhClaw/memory/`：记忆运行配置与日志
- `.ZxhClaw/sessions/v3/`：唯一会话落盘目录
- `.ZxhClaw/system-prompt/`：可覆写的 prompt 模板
- `.ZxhClaw/artifacts/docs/`：AI 生成并面向用户交付的文档产物

补充约束：

- 所有 AI 运行时数据统一写入项目根 `.ZxhClaw/`
- `backend/` 下不应再出现 `.sessions-*`、`.memory`、`.ZxhClaw`、`docs` 这类运行时产物目录
- 历史遗留目录会在后端启动时自动迁移到新的 `.ZxhClaw/` 结构后删除

## write_file 默认输出策略

- 修改项目代码、配置、文档时，仍按用户明确指定的项目路径写入。
- 生成给用户查看的 HTML、Markdown、文本报告、导出文件时，默认写入 `.ZxhClaw/artifacts/docs/`。
- 当 `write_file` 只收到裸文件名，且扩展名属于文档类产物（如 `.html`、`.md`、`.txt`、`.json`、`.csv`）时，后端会默认落到 `.ZxhClaw/artifacts/docs/`。
- 只有写入 `.ZxhClaw/artifacts/docs/` 的文件，会被当成“可展示产物”回传给前端复用文件卡片。
- 写到其它目录的文件视为内部工作结果，不自动在前端展示。
- 会话存储默认落在 `.ZxhClaw/sessions/v3/`，不再使用独立根 `.sessions-v3/`。

## 前端展示策略

- 前端复用现有上传文件卡片与右侧 `DocumentPanel`。
- AI 生成文件成功后，后端会把 `.ZxhClaw/artifacts/docs/` 下的产物作为文件附件事件推给前端。
- 打开历史会话时，也会从会话历史中恢复这些文件卡片。
