# 第一周第 2 件 — bash 工具接入 ChildProcessSandbox

> 更新日期：2026-05-08
> 类型：执行指令（喂给 Codex / Claude Code 直接执行）
> 关联：[CLAUDE.md](../../CLAUDE.md)、[20260508-2 代码现状审查报告](./20260508-2-个人强%20Agent%20路线%20代码现状审查报告.md)
> 前置：建议先完成 [20260508-3 清理通用框架代码](./20260508-3-清理通用框架代码%20执行指令.md)，但不严格依赖
> 预计耗时：1~2 小时（含写测试）

---

## 一、动手前必须读

1. [`/CLAUDE.md`](../../CLAUDE.md) — 项目守则
2. `backend/src/agent/tools/bash.ts`（当前实现，~80 行）
3. `backend/src/runtime/permissions/sandbox-adapter.ts`（已有的 `ChildProcessSandbox` 类，约 250 行）

---

## 二、目标（一句话）

把 `bash` 工具的命令执行从裸 `execSync` 切换到已实现但未接入的 `ChildProcessSandbox`，让 bash 工具自动获得环境变量白名单、cwd 强制锁定、可中断、统一超时控制。

这是一次**集成补完**，不是"新写沙箱"。沙箱本身写完了，本任务只是**改 import + 改调用**。

---

## 三、当前事实（现状）

`backend/src/agent/tools/bash.ts:5`：
```ts
import { execSync } from 'node:child_process'
```

`backend/src/agent/tools/bash.ts:23-27`：
```ts
const output = execSync(params.command, {
  cwd: PROJECT_ROOT,
  timeout: 120_000,
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
})
```

**问题**：
- 继承完整 `process.env`，包括 `LLM_API_KEY` 等敏感变量
- 没有 AbortSignal 集成
- 阻塞主线程（`execSync` 同步）

`backend/src/runtime/permissions/sandbox-adapter.ts:105-235` 已实现 `ChildProcessSandbox`：
- `DEFAULT_ENV_WHITELIST`：仅放行 PATH/HOME/LANG 等无害变量
- 强制 cwd
- spawn + AbortSignal
- 超时 + maxBuffer 双控

但**目前 `ChildProcessSandbox` 在生产代码里 0 引用**（只有它自己和测试文件用）。

---

## 四、不要做什么

- **不要**修改 `ChildProcessSandbox` 的实现——它已经写完且有测试
- **不要**新建任何抽象层——直接改 `bash.ts` 内部即可
- **不要**让 bash 工具去做"权限分级"或"危险命令拦截"——本任务只做沙箱集成，命令风险分级是另一个话题
- **不要**改 `bash.ts` 的对外接口（`AgentTool` 签名、参数 schema、返回 shape 不动）

---

## 五、动手清单

### 5.1 阅读 ChildProcessSandbox 接口

打开 `backend/src/runtime/permissions/sandbox-adapter.ts`，理清：

- 构造函数参数（`SandboxAdapterOptions`：cwd / envWhitelist / timeoutMs / maxBufferBytes 等）
- `execute(command, options)` 方法的入参与返回值
- 是否抛异常 / 还是返回 `{ stdout, stderr, exitCode, timedOut }`

阅读完确认你能用一行调用替换 `execSync`。

### 5.2 改写 bash.ts

按以下契约改：

- 顶部 import：`execSync` → `ChildProcessSandbox`（或直接 `import { ChildProcessSandbox } from '../../runtime/permissions/sandbox-adapter.js'`）
- 工具创建时实例化一次 sandbox（或在 execute 里实例化，取决于 sandbox 的 lifecycle 设计——读源码再定）
- `execute` 函数内：
  - 调用 `sandbox.execute(params.command, { cwd: PROJECT_ROOT, timeoutMs: 120_000 })`
  - 把 stdout / stderr / exitCode 转成现有的 `AgentToolResult` 格式
  - 超时 / 非 0 退出 / spawn 失败的错误信息保留可读性

### 5.3 处理边界

- **stderr 处理**：当前 `execSync` 在非 0 时抛异常并把 stderr 拼进 message。改写后要保持"非 0 退出 → 工具结果带 error 标记 + stderr 内容"的语义。
- **输出截断**：保留 `TOOL_OUTPUT_LIMIT = 50_000` 字符截断
- **AbortSignal**：如果 `AgentTool` 接口里能传 abort signal，把它链给 `ChildProcessSandbox`；如果接口不传，就不接，**不要为此修改 pi-agent-core 的接口**

### 5.4 写一个最小冒烟测试

新增 `backend/src/agent/tools/__tests__/bash.smoke.test.ts`（如不存在该测试文件夹，建在 `backend/src/agent/tools/bash.test.ts`），覆盖：

1. 简单命令执行 `echo hello` → 输出含 "hello"
2. 非 0 退出 `false` → 工具结果有 error 标记
3. 超时（用 `sleep 5` + 100ms 超时）→ 超时被捕获
4. **环境变量隔离**：`echo $LLM_API_KEY` → 输出为空（验证白名单生效）

这第 4 个测试是核心验证点——如果它过了，就说明环境变量泄露问题真的解决了。

---

## 六、验收口径

```bash
pnpm -F @lecquy/backend lint
pnpm -F @lecquy/backend build
pnpm -F @lecquy/backend test -- bash    # 跑 bash 相关测试
```

启动后端，让 agent 跑：

```
请用 bash 执行：echo "PATH 是 $PATH"
请用 bash 执行：echo "LLM_API_KEY 是 [$LLM_API_KEY]"
```

第一条应该有内容，第二条 `LLM_API_KEY` 应该为空字符串。这是肉眼级验证。

---

## 七、提交规范

```
refactor(bash): integrate ChildProcessSandbox to isolate env vars
```

PR 描述里链接本指令 + 第 5.4 段落里第 4 个测试的输出截图（或粘贴文本）。

---

## 八、执行报告（执行时填写）

```
- 5.1 阅读 ChildProcessSandbox：[完成 / 卡住]，关键 API：________
- 5.2 改写 bash.ts：[完成 / 部分完成 / 卡住]，diff 行数：________
- 5.3 边界处理：
    - stderr 语义保留：[是 / 否]
    - 输出截断保留：[是 / 否]
    - AbortSignal：[已接 / 接口不支持已跳过]
- 5.4 冒烟测试：4 条覆盖情况
    - echo hello：[pass / fail]
    - 非 0 退出：[pass / fail]
    - 超时捕获：[pass / fail]
    - 环境变量隔离：[pass / fail] ← 这条是核心
- 验收 build：[pass / fail]
- 验收手动跑 LLM_API_KEY：[空 / 仍有泄露]
```
