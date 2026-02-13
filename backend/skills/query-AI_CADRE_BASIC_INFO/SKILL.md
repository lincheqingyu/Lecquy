---
name: query-cadre_basic_info
description: 用于查询干部/人员的基本信息、简历、工作经历等。支持精确查找（如查特定人）和模糊搜索（如按名字特征搜索）。
model_type: instruct
direct_return: false
---

# 干部基本信息查询 (Query Cadre Basic Info)

## 概要
本技能将用户的自然语言请求转换为 SQL 查询语句，专门针对 `AI_CADRE_BASIC_INFO` 表进行查询。

## 数据表定义 (Schema Definition)

**表名**: `AI_CADRE_BASIC_INFO`
**注意事项**: 表中列名包含中文字符，生成 SQL 时**建议使用双引号**包裹中文列名，例如 `"姓名"`。

### 字段列表 (Columns)
AI 在生成 SQL 时，仅可选取以下字段：

| 字段名 (Column) | 类型 | 说明 |
| :--- | :--- | :--- |
| `CADREID` | VARCHAR2 | 干部唯一标识 ID |
| `"姓名"` | VARCHAR2 | 人员姓名 |
| `"性别"` | VARCHAR2 | 性别 |
| `"出生年月"` | VARCHAR | 格式通常为 YYYYMM |
| `"工作单位及职务"` | VARCHAR2 | 当前单位及职务描述 |
| `"民族"` | VARCHAR | 民族 |
| `"籍贯"` | VARCHAR2 | 籍贯 |
| `"出生地"` | VARCHAR2 | 出生地 |
| `"参加工作时间"` | VARCHAR | 格式通常为 YYYYMM |
| `"健康状况"` | VARCHAR | 健康描述 |
| `"专业技术职务"` | VARCHAR | 职称 |
| `"熟悉专业有何专长"` | VARCHAR2 | 专长描述 |
| `"政治面貌"` | VARCHAR | 党员/团员等 |
| `"入党时间"` | VARCHAR | 入党时间 |
| `"全日制教育学历"` | VARCHAR | 全日制学历 |
| `"全日制教育学位"` | VARCHAR | 全日制学位 |
| `"全日制教育院校名称"` | VARCHAR2 | 毕业院校 |
| `"全日制教育专业名称"` | VARCHAR2 | 专业 |
| `"在职教育学历"` | VARCHAR | 在职学历 |
| `"在职教育学位"` | VARCHAR | 在职学位 |
| `"在职教育院校名称"` | VARCHAR2 | 在职院校 |
| `"在职教育专业名称"` | VARCHAR2 | 在职专业 |
| `"简历"` | CLOB | 详细履历文本 |
| `"机构名称"` | VARCHAR2 | 所属机构名称 |
| `ORGID` | VARCHAR2 | 机构ID (系统字段) |
| `ARCHIVEID` | VARCHAR2 | 档案ID（用于调用档案API） |
| `DETAILSCHEMEID` | VARCHAR2 | 详细方案ID|
| `AISCHEMEID` | VARCHAR2 | AI方案ID （用于调用档案API） |

## 详细指令 (Instructions)

### 1. 意图识别与匹配策略
根据用户提问的方式，决定 `WHERE` 子句的匹配模式：

*   **精确匹配 (Exact Match)**
    *   **场景**: 用户明确指名道姓，指代特定对象。
    *   **示例**: "查询张三的信息", "张三的简历是什么", "谁是李四"
    *   **SQL逻辑**: `WHERE "姓名" = '张三'`
    
*   **模糊匹配 (Fuzzy Match)**
    *   **场景**: 用户使用描述性语言，或不确定具体名字。
    *   **示例**: "查找名字里带'建国'的人", "查询姓王的所有人", "找一下叫小明的"
    *   **SQL逻辑**: `WHERE "姓名" LIKE '%建国%'` 或 `WHERE "姓名" LIKE '王%'`

### 2. SQL 生成规范 (SQL Generation Rules)
1.  **Select Scope**: 
    *   如果用户未指定具体字段（如“查张三的信息”），请默认查询核心字段：`"姓名", "性别", "出生年月", "工作单位及职务", "机构名称"`。避免直接使用 `SELECT *` 以减少 CLOB 字段带来的性能开销，除非用户明确要求“详细简历”。
    *   如果用户指定字段（如“查张三的籍贯”），仅查询 `"姓名"` 和 `"籍贯"`。
2.  **Quoting**: 凡是中文列名，必须使用双引号包裹，例如 `SELECT "姓名" FROM ...`。
3.  **Security**: 仅允许生成 `SELECT` 语句。严禁生成 `UPDATE`, `DELETE`, `DROP`。

### 3. 查询失败自愈策略
当 `execute_sql` 返回错误（`success: false`）或空结果（`row_count: 0`）时，按以下步骤排查：

1. **查字段**：执行 `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='AI_CADRE_BASIC_INFO'`，确认实际存在的列名。
2. **查字段值**：对目标字段执行 `SELECT DISTINCT "字段名" FROM AI_CADRE_BASIC_INFO WHERE ROWNUM <= 20`，了解该字段的实际取值。
3. **修正查询**：根据实际字段名和值重新构造 SQL，再次调用 `execute_sql`。

### 4. 未知字段处理
当用户提问涉及本文档未列出的字段时，先执行探查查询获取所有列名：
```sql
SELECT * FROM AI_CADRE_BASIC_INFO WHERE ROWNUM <= 1
```
根据返回结果判断是否存在相关字段，再决定如何构造查询。

## 示例 (Examples)

**User**: 帮我查一下张三的个人资料。
**AI Thought**: 用户指定了具体姓名“张三”，使用精确匹配。默认返回核心信息。
**Tool Call**:
```json
{
  "sql": "SELECT \"姓名\", \"性别\", \"出生年月\", \"工作单位及职务\", \"机构名称\" FROM AI_CADRE_BASIC_INFO WHERE \"姓名\" = '张三'"
}
```

**User**: 看看有没有名字里带“伟”字的干部，把他们的单位列出来。
**AI Thought**: 用户要求“名字里带...”，使用模糊匹配 LIKE。用户只请求了“单位”。
**Tool Call**:
```json
{
  "sql": "SELECT \"姓名\", \"工作单位及职务\" FROM AI_CADRE_BASIC_INFO WHERE \"姓名\" LIKE '%伟%'"
}
```

**User**:查询张三的AI档案。
**AI Thought**: 用户指定了"张三"（精确匹配）并明确要求"AI档案"（查询 ARCHIVEID 和 AISCHEMEID，并调用skill get-AI_ARCHIVE）。
**Tool Call**:
```json
{
  "sql": "SELECT \"ARCHIVEID\", \"AISCHEMEID\" FROM AI_CADRE_BASIC_INFO WHERE \"姓名\" = '张三'"
}
```

## 工具使用 (Tool Usage)

### execute_sql 工具

当你需要执行 SQL 查询时，使用 `execute_sql` 工具：

**工具名称**: `execute_sql`

**参数**:
- `sql` (必需): SQL SELECT 语句（字符串）
- `max_rows` (可选): 最大返回行数，默认 100

**响应格式**: JSON 字符串，包含以下字段：
```json
{
  "success": true,
  "row_count": 3,
  "total_rows": 3,
  "columns": ["姓名", "性别", "出生年月"],
  "data": [
    {"姓名": "张三", "性别": "男", "出生年月": "198001"},
    {"姓名": "李四", "性别": "女", "出生年月": "199002"}
  ],
  "truncated": false
}
```

**完整示例**:

用户: "查询张三的基本信息"

1. **生成 SQL**（遵循上述规范）:
   ```sql
   SELECT "姓名", "性别", "出生年月", "工作单位及职务", "机构名称"
   FROM AI_CADRE_BASIC_INFO
   WHERE "姓名" = '张三'
   ```

2. **调用 execute_sql 工具**:
   ```json
   {
     "name": "execute_sql",
     "arguments": {
       "sql": "SELECT \"姓名\", \"性别\", \"出生年月\", \"工作单位及职务\", \"机构名称\" FROM AI_CADRE_BASIC_INFO WHERE \"姓名\" = '张三'",
       "max_rows": 100
     }
   }
   ```

3. **处理结果并向用户展示**:
   - 如果 `success: true`，格式化 `data` 字段展示给用户
   - 如果 `success: false`，向用户解释 `error` 信息

**注意事项**:
- ⚠️ 必须先调用 `execute_sql` 工具执行 SQL，再向用户返回结果
- ⚠️ 不要只生成 SQL 而不执行
- ⚠️ 确保 SQL 语法正确，中文列名使用双引号包裹
- ⚠️ 如果查询失败，检查 SQL 语法或数据库连接配置