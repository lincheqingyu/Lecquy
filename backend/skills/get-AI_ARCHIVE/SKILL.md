---
name: get-ai_archive
description: 获取干部的AI档案详细业务数据。需要先查询基本信息获取档案ID，再调用档案API。
model_type: instruct
direct_return: true
---

# AI 档案获取 (Get AI Archive)

## 概要
本技能用于获取干部的AI档案详细业务数据。流程分两步：
1. 使用 `execute_sql` 查询 `AI_CADRE_BASIC_INFO` 表，获取目标人员的 `ARCHIVEID` 和 `AISCHEMEID`
2. 使用 `get_ai_archive_data` 工具，传入上一步获取的两个 ID，调用档案 API

## 使用流程

### 第一步：查询档案 ID
使用 execute_sql 工具查询：
```sql
SELECT "姓名", ARCHIVEID, AISCHEMEID
FROM AI_CADRE_BASIC_INFO
WHERE "姓名" = '张三'
```

### 第二步：获取档案数据
将查询到的 ARCHIVEID 和 AISCHEMEID 传入 get_ai_archive_data 工具：
```json
{
  "name": "get_ai_archive_data",
  "arguments": {
    "archive_id": "<ARCHIVEID的值>",
    "scheme_id": "<AISCHEMEID的值>"
  }
}
```

## 注意事项
- 必须先查到 ID 再调用档案 API，不能跳过第一步
- 如果上下文中存在该人员的ID，则直接调用
- 如果 SQL 查询无结果，告知用户未找到该人员
- 档案数据量大，工具会自动截取前 50 条记录
