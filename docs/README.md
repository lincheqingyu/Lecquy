# Lecquy Docs

项目文档统一收敛在根目录 `docs/` 下，并按“项目级 / 环境配置 / 前端 / 后端”分组维护。

## 目录导航

- [项目级](./项目级/)：项目总览、Monorepo 使用、产品方向等跨前后端文档
- [环境与配置](./环境与配置/)：环境变量、运行参数、本地配置说明
- [前端文档](./frontend/)：前端规范、网络资源、Markdown 渲染排障
- [后端文档](./backend/README.md)：后端架构、接口、记忆检索、Prompt 与运行时、专题探索

## 当前主线

- [项目级 / 20260408-1-Monorepo 使用指南 技术规范.md](./项目级/20260408-1-Monorepo%20使用指南%20技术规范.md)：了解 workspace 结构和常用命令
- [项目级 / 20260408-2-个人强 Agent 路线 开发规划.md](./项目级/20260408-2-个人强%20Agent%20路线%20开发规划.md)：记录 Lecquy 从 AI Web 向"个人强 Agent"演进的方向
- [项目级 / 20260508-1-个人强 Agent 路线 代码现状审查指令.md](./项目级/20260508-1-个人强%20Agent%20路线%20代码现状审查指令.md)：用 JARVIS / hermes-agent 锚点重审代码、由外部 LLM 出事实清单的审查模板
- [项目级 / 20260508-2-个人强 Agent 路线 代码现状审查报告.md](./项目级/20260508-2-个人强%20Agent%20路线%20代码现状审查报告.md)：DeepSeek 跑出的事实清单——记忆/上下文/循环/压缩/进化接口/沙箱/通用框架占比的现状定级 + 总览表
- [项目级 / 20260508-3-清理通用框架代码 执行指令.md](./项目级/20260508-3-清理通用框架代码%20执行指令.md)：第一周第 1 件——删 HTTP 旧路由 / 旧 Session 模块 / 多 Session 协作工具，喂给 codex 直接执行
- [项目级 / 20260508-4-bash 接入 ChildProcessSandbox 执行指令.md](./项目级/20260508-4-bash%20接入%20ChildProcessSandbox%20执行指令.md)：第一周第 2 件——bash 工具切换沙箱，环境变量隔离 + cwd 锁定 + AbortSignal 集成
- [项目级 / 20260508-5-人格基线 USER SOUL MEMORY 撰写指引.md](./项目级/20260508-5-人格基线%20USER%20SOUL%20MEMORY%20撰写指引.md)：第一周第 3 件——kira 本人手写 .lecquy/USER.md / SOUL.md / MEMORY.md，立刻让 agent "认识你"
- [项目级 / 20260508-6-第二周第 1 件 SQLite 记忆落地 执行指令.md](./项目级/20260508-6-第二周第%201%20件%20SQLite%20记忆落地%20执行指令.md)：第二周第 1 件——`better-sqlite3` + FTS5 替代 PG，extraction-runner 同步改造，project_id 维度 tag 落地
- [项目级 / 20260508-7-第二周第 2 件 召回切换到 SQLite 执行指令.md](./项目级/20260508-7-第二周第%202%20件%20召回切换到%20SQLite%20执行指令.md)：第二周第 2 件——prompt-injector 切到 SQLite 召回，合成排序公式（BM25 + importance + 时间衰减 + 项目软优先）
- [项目级 / 20260508-8-SQLite 记忆冒烟回归修复 执行指令.md](./项目级/20260508-8-SQLite%20记忆冒烟回归修复%20执行指令.md)：第 1 件冒烟暴露的"重复提取"修复——新增 watermark 表 + 提取水位机制 + dedupe.sql 清理脏数据
- [项目级 / 20260508-9-上下文爆炸事故 排查与修复 执行指令.md](./项目级/20260508-9-上下文爆炸事故%20排查与修复%20执行指令.md)：第二件冒烟时触发 1.25M tokens 超 1M 上下文上限事故——诊断日志注入 + 6 类候选根因 + 分支修复策略（已被第 10 份取代，保留作排查方法论）
- [项目级 / 20260508-10-上下文爆炸 根因定位与修复 执行指令.md](./项目级/20260508-10-上下文爆炸%20根因定位与修复%20执行指令.md)：根因锁定 sessions_history 工具——加默认 limit + 输出截断 + 'current' 关键字处理；同类工具 sessions_list / sessions_send 同等防御
- [项目级 / 20260509-11-上下文爆炸 精准排查报告.md](./项目级/20260509-11-上下文爆炸%20精准排查报告.md)：codex 基于第 10 份指令的精准排查产物——发现单条消息 5.3MB base64 图片是真凶，4 个 session-tools 全部缺 TOOL_OUTPUT_LIMIT 截断；纠正了第 10 份指令中 runtime.ts 修改的判断错误
- [项目级 / 20260509-1-上下文架构修复 in-loop 压缩 执行指令.md](./项目级/20260509-1-上下文架构修复%20in-loop%20压缩%20执行指令.md)：上下文管理结构层修复——在三个 runner 注册 `transformContext` 钩子接入 in-loop 压缩、按 Phase 2 落地 token-aware 触发、上传层加体积上限（双层校验+静默截断）；附带"跨 turn 工具失忆是有意设计"等三条决策记录
- [项目级 / 20260510-1-会话连续性修复 peerId 与 UI 状态同步 执行指令.md](./项目级/20260510-1-会话连续性修复%20peerId%20与%20UI%20状态同步%20执行指令.md)：修复"关浏览器再开 → UI 显新会话但消息进旧会话"的撕裂 bug——纯前端最小修复（新增 `lecquy.lastActiveSessionKey` 持久化 + 冷启动反查恢复 + 残留 peerId 清理），明确放弃 DeepSeek 方案 A，且不动后端 dm 路由（peerId → sessionId 重命名留待后续结构性重构）
- [项目级 / 20260512-1-开源项目 system prompt 构成对比分析 审查指令.md](./项目级/20260512-1-开源项目%20system%20prompt%20构成对比分析%20审查指令.md)：喂给 Codex 执行的审查指令——对照 hermes-agent / Kuberwastaken-src / openclaw / opencode / system-prompts-and-models-of-ai-tools 5 个仓库，分析各自 system prompt 的组成、顺序、静态 / 动态分层、设计意图，映射回 Lecquy 6 文件设计的 5 个待决问题（soul/identity 是否合并 / user.md 是否拆 / memory 是否打 tag / tools 纪律是否独立 / agents.md 是否需要）；附借鉴 / 不借鉴清单格式约束 + 严禁建议清单（不引入鉴权 / OAuth / 多租户 / MCP 完整协议）
- [项目级 / 20260512-2-系统提示词上下文工程最终取舍 技术规范.md](./项目级/20260512-2-系统提示词上下文工程最终取舍%20技术规范.md)：作为后续 system prompt 结构落地的权威技术方向；不再区分 v1/v2，最终锁定少量常驻文件 + 固定 prompt layer + SQLite 记忆检索 + 按需技能加载；明确不新增 `core.md`、`tools-discipline.md`、`context-loader.md`、`agent.yaml`，并补充 `MEMORY.md` / `MEMORY.summary.md` 职责、`USER.md` 预算、prompt injection 防护、cache boundary 与未来拆分条件
- [项目级 / 20260512-3-system-prompt 最终架构落地 执行指令.md](./项目级/20260512-3-system-prompt%20最终架构落地%20执行指令.md)：喂给 Codex 的落地执行指令——把 20260512-2 锁定的最终架构落到 `.lecquy/` 真实目录 + backend 代码。分 4 个 Phase（0 现状勘察 / 1 文件骨架 / 2 prompt builder 7 层重构 / 3 memory schema 9 维标签迁移 / 4 验收），**本指令只覆盖 Phase 0 + 1**，2/3/4 各自独立指令。强约束：不重新设计文件体系、不引入 `core.md` / `tools-discipline.md` / `context-loader.md` / `agent.yaml`、不主动改写用户已有人格文件内容、每个 Phase 完成必须停等 kira review、git commit 单文件颗粒度便于回滚。预期产出 Codex 交付 `20260512-4-...勘察报告.md` 和 `20260512-5-...Phase 1 验收记录.md`
- [环境与配置 / 20260408-8-环境参数配置 技术规范.md](./环境与配置/20260408-8-环境参数配置%20技术规范.md)：统一本地环境变量与配置入口
- [后端 / 记忆与检索 / 20260408-3-Runtime Memory Compact 决策沉淀 技术规范.md](./backend/记忆与检索/20260408-3-Runtime%20Memory%20Compact%20决策沉淀%20技术规范.md)：后端记忆 / compact 决策基线
- [后端 / Claude 上下文压缩复刻 / 20260430-14-Phase 1 codex 审查报告.md](./backend/Claude%20上下文压缩复刻/20260430-14-Phase%201%20codex%20审查报告.md)：Phase 1 LLM 摘要升级的 codex 审查与分诊结论
- [后端 / Claude 上下文压缩复刻 / 20260430-15-Phase 2 token-aware 触发策略 技术规范.md](./backend/Claude%20上下文压缩复刻/20260430-15-Phase%202%20token-aware%20触发策略%20技术规范.md)：Phase 2 token-aware 压缩触发策略、recent tail token budget 与验收口径
- [后端 / 沙箱权限与命令拦截 / 20260424-1-Codex 风格权限审批协议 技术规范.md](./backend/沙箱权限与命令拦截/20260424-1-Codex%20风格权限审批协议%20技术规范.md)：确认权限审批采用 WS 传输 + Codex-style server request 协议
- [前端 / 20260417-1-Markdown 渲染排障 技术规范.md](./frontend/20260417-1-Markdown%20渲染排障%20技术规范.md)：前端 Markdown 渲染问题排障入口
- [前端 / 20260422-1-消息时间线与工具动作呈现 技术规范.md](./frontend/20260422-1-消息时间线与工具动作呈现%20技术规范.md)：统一思考、tool 与文件动作在消息时间线中的展示口径
- [前端 / 20260423-1-消息时间线视觉收敛 技术规范.md](./frontend/20260423-1-消息时间线视觉收敛%20技术规范.md)：时间线事件原语 `TimelineEvent` 收敛 + `ArtifactPanel` 流式跟随（替代 20260422-2，后者已归档）
- [前端 / 20260429-1-上下文占比圆圈指示器 技术规范.md](./frontend/20260429-1-上下文占比圆圈指示器%20技术规范.md)：ProgressCircle SVG 实现、token 计算链路、本地/API 模型有效性分析
- [前端 / 20260509-2-流式渲染卡顿排查 审查报告.md](./frontend/20260509-2-流式渲染卡顿排查%20审查报告.md)：全链路排查流式渲染卡顿，定位 5 个前端瓶颈点（MessageItem 缺 memo、StreamdownMarkdown 重解析、thinking 计时器等），附修复方案按投入产出比排序
- [前端 / 20260509-3-流式渲染卡顿 第二轮排查 审查报告.md](./frontend/20260509-3-流式渲染卡顿%20第二轮排查%20审查报告.md)：第二轮在第一轮"组件层"基础上挖出渲染管线 / 副作用层结构性问题——MessageList 每帧双重布局回弹（layout thrashing）、createBlocksSignature/summarizeBlocks 在 debug 关闭时仍全量序列化、N 个 MutationObserver、StreamdownMarkdown hooks 违例等；附与第一轮合并后的 P0-P3 优先级表
- [前端 / 20260509-4-流式渲染卡顿 治本修复 执行指令.md](./frontend/20260509-4-流式渲染卡顿%20治本修复%20执行指令.md)：取代前两份审查报告里的修复建议；按"治本 + 删代码 + 长对话不复现"三条标准把方案分三阶段——阶段一（删 chat-stream-debug 整套 / 删死代码 / overflow-anchor 替手写贴底 / 修 hooks 顺序，约 250 行净减）、阶段二（memo 一族 + dark-mode 提全局，实测后决定）、阶段三（虚拟化 + 流式消息脱离 React，仅长对话不达标时启动）；含明确拒绝清单（rAF throttle / 引入状态管理库 / 上游 fork）
- [前端 / 20260513-1-设置栏极简重设计 技术规范.md](./frontend/20260513-1-设置栏极简重设计%20技术规范.md)：右侧 `SettingsDrawer` 模仿 Claude 视觉重设计——删除两套二级面板（`isContextPanelOpen` / `isModelPanelOpen`）改行内 accordion、去掉 `railCard*` 卡片容器与 10+ 装饰性图标、按 AGENT / SAMPLING / TOOLS / REASONING / ROLE CONTEXT / KERNEL / MEMORY RUNTIME 七分区线性化；附 §5 字段到 pi-agent-core 参数映射表和 §8 验收口径。本规范只定方向，落地由后续 `20260513-2-...执行指令.md` 接力
- [前端 / 20260513-2-右侧工作区设计 技术规范.md](./frontend/20260513-2-右侧工作区设计%20技术规范.md)：把右侧从独立 Settings 抽屉提升为统一 RightRail 工作区；定义 Context / Progress / Artifact / Memory / Runtime / Approval 六个 mode、优先级、视觉语言、响应式策略和迁移路径，作为后续右侧重构方向备份
- [前端 / 20260513-3-右侧工作区人机交互逻辑 技术规范.md](./frontend/20260513-3-右侧工作区人机交互逻辑%20技术规范.md)：以 Claude Code 的伴随式右侧工作区为主要参考，从真实编码/等待/查看文件/审批/调整 runtime/追溯记忆场景反推 RightRail 的 HCI 逻辑；定义用户显式优先、弱自动打开、Approval 阻塞置顶、Esc/focus、响应式、会话级持久化，以及“严格模仿 Claude Code UI、禁止在旧 UI 上反复补丁、允许从头重构”的实现硬规则

## 归档说明

- 旧的图表渲染问题交接文档已移入 [frontend/历史归档](./frontend/历史归档/)；正式排障请优先查看当前前端文档。
