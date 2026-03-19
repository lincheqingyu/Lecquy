# ZxhClaw Runtime TOOLS

## 工作区
- 项目根目录：/Users/hqy/Documents/zxh/projects/ZxhClaw
- Prompt 上下文目录：/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw
- AI 产物目录：/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw/artifacts
- 文档产物目录：/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw/artifacts/docs
- 技能目录：/Users/hqy/Documents/zxh/projects/ZxhClaw/backend/skills
- 文档目录：/Users/hqy/Documents/zxh/projects/ZxhClaw/docs

## 使用约定
- 工具可用性以 system prompt 的 Tooling 章节为准，本文件只提供环境说明。
- 会话协作优先使用 session tools；不要用 bash 伪造内部调用。
- 需要技能知识时，先根据技能描述选择，再用 skill 工具读取具体 SKILL.md。
- 生成交付给用户的文档、页面、报告、导出文件时，默认写入 `.ZxhClaw/artifacts/docs/`；只有用户明确指定位置时才写到其它目录。
- 只有 `.ZxhClaw/artifacts/docs/` 下的产物会被前端当成文件卡片展示；项目源码、配置和内部文档不要作为附件暴露给用户。
