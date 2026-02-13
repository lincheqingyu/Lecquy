# WebClaw 后端 API 接口文档

## 基础信息

| 项目 | 说明 |
|------|------|
| 基础地址 | `http://localhost:3000` |
| 内容类型 | `application/json` |
| 字符编码 | UTF-8 |

### 通用请求头

```
Content-Type: application/json
```

### 通用响应格式

**成功响应：**

```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应：**

```json
{
  "success": false,
  "error": "错误描述信息"
}
```

---

## 接口列表

### 1. 健康检查

检查服务运行状态及已注册的 LLM Provider 列表。

```
GET /health
```

#### curl 示例

```bash
curl http://localhost:3000/health
```

#### 成功响应 `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2026-02-13T08:30:00.000Z",
  "providers": ["openai-compatible"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `"ok"` | 固定值，表示服务正常 |
| `timestamp` | `string` | ISO 8601 格式的当前时间 |
| `providers` | `string[]` | 已注册的 Provider 名称列表 |

---

### 2. 对话

发送对话消息，支持同步返回完整响应或通过 SSE 流式接收。通过请求体中的 `stream` 参数控制响应方式。

```
POST /api/v1/chat
```

#### 请求体结构

```typescript
{
  // 对话消息列表，至少包含一条消息
  "messages": [
    {
      "role": "system" | "user" | "assistant",  // 消息角色
      "content": "消息内容"                       // 不能为空字符串
    }
  ],
  // 可选：启用流式响应（默认 false）
  "stream": false,
  // 可选：指定 Provider 名称
  "provider": "openai-compatible",
  // 可选：对话参数
  "options": {
    "model": "glm-4-plus",    // 模型名称
    "temperature": 0.7,        // 温度，范围 0~2
    "maxTokens": 8192          // 最大生成 token 数，正整数
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `messages` | `Array` | 是 | 对话消息列表，至少一条 |
| `stream` | `boolean` | 否 | 是否启用流式响应，默认 `false` |
| `provider` | `string` | 否 | 指定 Provider 名称 |
| `options` | `object` | 否 | 对话参数（model、temperature、maxTokens） |

#### curl 示例 — 同步请求

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "你好，请介绍一下你自己" }
    ]
  }'
```

#### curl 示例 — 带选项的同步请求

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "system", "content": "你是一个专业的编程助手" },
      { "role": "user", "content": "用 TypeScript 写一个快速排序函数" }
    ],
    "options": {
      "model": "glm-4-plus",
      "temperature": 0.3,
      "maxTokens": 2048
    }
  }'
```

#### curl 示例 — 流式请求

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "messages": [
      { "role": "user", "content": "用三句话介绍 TypeScript" }
    ],
    "stream": true
  }'
```

> `-N` 参数禁用 curl 输出缓冲，以便实时查看 SSE 事件流。

#### 同步响应 `200 OK`

当 `stream` 为 `false` 或未传时，返回 JSON：

```json
{
  "success": true,
  "data": {
    "content": "你好！我是一个 AI 助手，很高兴为你服务。",
    "model": "glm-4-plus",
    "provider": "openai-compatible",
    "usage": {
      "promptTokens": 12,
      "completionTokens": 28,
      "totalTokens": 40
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.content` | `string` | LLM 生成的回复内容 |
| `data.model` | `string` | 实际使用的模型名称 |
| `data.provider` | `string` | 实际使用的 Provider 名称 |
| `data.usage` | `object \| undefined` | Token 用量统计（部分 Provider 可能不返回） |
| `data.usage.promptTokens` | `number` | 输入 token 数 |
| `data.usage.completionTokens` | `number` | 输出 token 数 |
| `data.usage.totalTokens` | `number` | 总 token 数 |

#### 流式响应 (SSE)

当 `stream` 为 `true` 时，返回 Server-Sent Events 事件流。

**响应头：**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**`message` 事件** — 文本片段

```
event: message
data: {"content":"TypeScript"}

event: message
data: {"content":" 是一种"}

event: message
data: {"content":"强类型的"}
```

**`done` 事件** — 流结束标志

```
event: done
data: {"done":true}
```

#### 完整事件流示例

```
event: message
data: {"content":"Type"}

event: message
data: {"content":"Script"}

event: message
data: {"content":" 是 JavaScript 的超集，"}

event: message
data: {"content":"添加了静态类型系统。"}

event: done
data: {"done":true}
```

#### 错误响应 `400 Bad Request`

请求参数校验失败时返回：

```json
{
  "success": false,
  "error": "至少需要一条消息"
}
```

```json
{
  "success": false,
  "error": "消息内容不能为空"
}
```

#### JavaScript 客户端示例 — fetch 流式

```typescript
async function chatStream(messages: Array<{ role: string; content: string }>) {
  const response = await fetch('http://localhost:3000/api/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 按双换行符分割 SSE 事件
    const events = buffer.split('\n\n')
    // 最后一段可能不完整，留到下次处理
    buffer = events.pop() ?? ''

    for (const event of events) {
      const lines = event.split('\n')
      const eventType = lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim()
      const dataLine = lines.find((l) => l.startsWith('data:'))
      if (!dataLine) continue

      const data = JSON.parse(dataLine.slice(5).trim())

      if (eventType === 'message') {
        // 逐片段追加内容
        process.stdout.write(data.content)
      } else if (eventType === 'done') {
        // 流结束
        console.log('\n[完成]')
      }
    }
  }
}

// 使用示例
chatStream([{ role: 'user', content: '你好' }])
```

#### JavaScript 客户端示例 — EventSource 封装

> 注意：原生 `EventSource` 仅支持 GET 请求。对于 POST 请求，需要使用 fetch + ReadableStream（如上），或使用第三方库如 `eventsource-parser`。

```typescript
import { EventSourceParserStream } from 'eventsource-parser/stream'

async function chatStreamWithParser(
  messages: Array<{ role: string; content: string }>,
) {
  const response = await fetch('http://localhost:3000/api/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const stream = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())

  for await (const event of stream) {
    if (event.event === 'message') {
      const data = JSON.parse(event.data)
      process.stdout.write(data.content)
    } else if (event.event === 'done') {
      console.log('\n[完成]')
    }
  }
}
```

---

## 错误码参考

| HTTP 状态码 | 场景 | 示例错误信息 |
|-------------|------|-------------|
| `400` | 请求参数校验失败 | `"至少需要一条消息"` |
| `400` | 消息内容为空 | `"消息内容不能为空"` |
| `400` | 参数类型错误 | `"Expected number, received string"` |
| `500` | 服务器内部错误（LLM 调用失败等） | `"服务器内部错误"` |

> 500 错误统一返回 `"服务器内部错误"`，不会泄露内部实现细节。具体错误信息记录在服务端日志中。

---

## 环境变量配置参考

复制 `.env.example` 为 `.env`，按需修改：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | 服务监听端口 |
| `NODE_ENV` | 否 | `development` | 运行环境：`development` / `production` / `test` |
| `LOG_LEVEL` | 否 | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `LLM_API_KEY` | **是** | — | LLM 服务 API Key |
| `LLM_BASE_URL` | 否 | `https://open.bigmodel.cn/api/paas/v4/` | LLM API 基础地址 |
| `LLM_MODEL` | 否 | `glm-4-plus` | 默认模型名称 |
| `LLM_TEMPERATURE` | 否 | `0.7` | 默认温度（0~2） |
| `LLM_MAX_TOKENS` | 否 | `8192` | 默认最大生成 token 数 |
| `LLM_TIMEOUT` | 否 | `120000` | 请求超时时间（毫秒） |

### 配置示例

```bash
# 使用智谱 AI（默认）
LLM_API_KEY=your-zhipu-api-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-plus

# 使用 OpenAI
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# 使用 DeepSeek
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```
