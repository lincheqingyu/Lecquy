# PaperQA 风格 RAG 参考项目探索

更新日期：2026-04-08

## 1. 探索目标

这份文档用于约束后续对 Paper-QA 风格系统的探索重点，避免把注意力浪费在无关特性上。

## 1.1 本地参考仓库目录

以后默认优先阅读本地参考仓库代码，不再把线上搜索作为第一入口。

本地参考仓库：

- `/Users/hqy/Documents/zxh/github/paper-qa`

后续优先阅读这些文件：

- `/Users/hqy/Documents/zxh/github/paper-qa/README.md`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/settings.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/docs.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/readers.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/core.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/prompts.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/types.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/agents/tools.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/agents/search.py`

阅读顺序建议：

1. 先看 `README.md` 的算法总览
2. 再看 `settings.py` 里的关键超参数
3. 再看 `docs.py` 的 `aadd / retrieve_texts / aget_evidence / aquery`
4. 最后看 `readers.py / core.py / prompts.py / types.py` 理解 chunk、证据对象和 citation 约束

## 2. 必答问题

后续每次探索至少回答下面 5 个问题：

1. Paper-QA 的 chunk 组织方式是什么
2. Paper-QA 如何做检索与筛选
3. Paper-QA 的回答如何体现“证据驱动”
4. 哪些能力是效果核心，哪些只是配套设施
5. 哪些部分适合当前 Lecquy 先做，哪些应推后

## 3. 输出要求

每次探索应至少产出：

- 参考实现链路摘要
- 可复刻点
- 不可直接复刻点
- 下一步最小实验建议

## 4. 当前已知优先级

优先研究：

- retrieval
- evidence selection
- answer synthesis

后研究：

- citation 样式细节
- 多格式导入
- 大型文档管理体验

## 5. 当前边界

这份探索文档的目标不是直接变成功能开发，而是为后续的独立 RAG 路线提供高质量输入。
