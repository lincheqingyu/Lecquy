# Lecquy

## 项目概述

基于浏览器的终端风格 AI 对话客户端，纯前端 SPA 应用。

## 技术栈

Node.js 24.13 · Vite 7.x · React 19.x · TypeScript 5.9 · Tailwind CSS 4

## 核心能力

### 命令 Commands

| 命令 | 用途 |
|------|------|
| `/plan` | 创建实现计划，等待用户确认 |
| `/tdd` | 测试驱动开发（测试优先） |
| `/code-review` | 代码质量审查 |
| `/build-fix` | 修复构建/类型错误 |
| `/refactor-clean` | 清理死代码和重构 |

### 智能体 Agents

| 智能体 | 触发方式 | 用途 |
|--------|----------|------|
| `planner` | `/plan` 或 `EnterPlanMode` | 制定实现计划 |
| `architect` | 主动调用 | 架构设计和决策 |
| `code-reviewer` | `/code-review` 或主动 | 代码质量审查 |
| `build-error-resolver` | 构建失败时自动 | 修复构建错误 |
| `tdd-guide` | `/tdd` 或主动 | TDD 工作流指导 |
| `refactor-cleaner` | `/refactor-clean` | 清理未使用代码 |
| `security-reviewer` | 主动调用 | 安全漏洞检测 |

### 技能 Skills

#### 前端与设计

| 技能 | 用途 |
|------|------|
| `frontend-design` | 生产级前端界面设计 |
| `frontend-patterns` | React/Next.js 前端模式 |
| `interface-design` | 仪表板、管理面板等界面 |
| `ui-analyzer` | 从截图生成 React 组件 |
| `ui-ux-pro-max` | UI/UX 设计智能（50样式，21色板） |
| `playground` | 创建交互式 HTML 体验页/探索器 |

#### 开发工具

| 技能 | 用途 |
|------|------|
| `coding-standards` | 编码规范和最佳实践 |
| `webapp-testing` | Playwright E2E 测试 |

#### Claude 扩展

| 技能 | 用途 |
|------|------|
| `agent-development` | Claude Agent 开发 |
| `command-development` | Claude 命令开发 |
| `hook-development` | Claude Hook 开发 |
| `skill-development` | Claude 技能开发 |
| `mcp-integration` | MCP 集成 |
| `plugin-settings` | 插件设置 |
| `plugin-structure` | 插件结构 |
| `claude-automation-recommender` | Claude 自动化推荐 |
| `claude-md-improver` | CLAUDE.md 优化 |
| `writing-hookify-rules` | Hookify 规则编写 |

### 规则 Rules

- **coding-style** — 不可变性、小文件、错误处理
- **security** — 无硬编码密钥、输入验证、XSS 防护
- **testing** — 80% 覆盖率，TDD 工作流
- **git-workflow** — Conventional Commits，PR 审查
- **language** — 中文注释/对话，英文代码/配置

## 目录结构

```
src/
├── app/                    # 应用层
│   └── home/               # 首页模块
│       ├── page.tsx        # 首页入口
│       └── components/     # 首页组件
│           ├── HomePageLayout.tsx    # 主布局容器
│           ├── ConversationArea.tsx   # 对话区域
│           └── SettingsDrawer.tsx     # 设置抽屉
├── features/               # 功能模块
├── components/             # 通用 UI 组件
│   └── ui/                 # 原语组件
├── hooks/                  # 全局自定义 Hooks
├── lib/                    # 工具库
├── stores/                 # 全局状态管理
├── config/                 # 配置文件
├── styles/                 # 样式文件
└── types/                  # 全局类型定义
```
