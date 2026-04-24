/**
 * 可重连 WebSocket 封装
 * 支持指数退避重连、消息队列、心跳响应
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

interface ReconnectableWsOptions {
  /** 完整 WS URL */
  readonly url: string
  /** 收到消息回调 */
  readonly onMessage: (data: string) => void
  /** 建连成功回调 */
  readonly onOpen?: () => void
  /** 连接状态变化回调 */
  readonly onStatusChange: (status: ConnectionStatus) => void
  /** 最大重试次数 */
  readonly maxRetries?: number
  /** 初始重试间隔（毫秒） */
  readonly initialDelay?: number
}

/** 消息队列上限 */
const MAX_QUEUE_SIZE = 10

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 5

/** 默认初始重试间隔 */
const DEFAULT_INITIAL_DELAY = 500

export class ReconnectableWs {
  private ws: WebSocket | null = null
  private readonly messageQueue: string[] = []
  private retryCount = 0
  private intentionalClose = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private status: ConnectionStatus = 'connecting'

  private readonly url: string
  private readonly onMessage: (data: string) => void
  private readonly onOpen?: () => void
  private readonly onStatusChange: (status: ConnectionStatus) => void
  private readonly maxRetries: number
  private readonly initialDelay: number

  constructor(options: ReconnectableWsOptions) {
    this.url = options.url
    this.onMessage = options.onMessage
    this.onOpen = options.onOpen
    this.onStatusChange = options.onStatusChange
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.initialDelay = options.initialDelay ?? DEFAULT_INITIAL_DELAY

    this.connect()
  }

  /** 发送消息，未连接时自动入队 */
  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return
    }

    // 队列未满时入队
    if (this.messageQueue.length < MAX_QUEUE_SIZE) {
      this.messageQueue.push(data)
    }
  }

  /** 主动关闭，不触发重连 */
  close(): void {
    this.intentionalClose = true
    this.clearReconnectTimer()
    this.ws?.close()
    this.ws = null
    this.updateStatus('disconnected')
  }

  /** 获取当前连接状态 */
  getStatus(): ConnectionStatus {
    return this.status
  }

  private connect(): void {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.retryCount = 0
      this.updateStatus('connected')
      this.onOpen?.()
      this.flushQueue()
    }

    this.ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : String(event.data)

      // 自动回复 ping
      try {
        const parsed = JSON.parse(data) as { event?: string }
        if (parsed.event === 'ping') {
          this.ws?.send(JSON.stringify({ event: 'pong', payload: { timestamp: Date.now() } }))
          return
        }
      } catch {
        // 解析失败，按普通消息处理
      }

      this.onMessage(data)
    }

    this.ws.onclose = () => {
      this.ws = null
      if (!this.intentionalClose) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose 会紧跟触发，这里不需要额外处理
    }
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= this.maxRetries) {
      this.updateStatus('disconnected')
      return
    }

    this.updateStatus('reconnecting')
    const delay = this.initialDelay * Math.pow(2, this.retryCount)
    this.retryCount++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift()
      if (msg) this.ws.send(msg)
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus
      this.onStatusChange(newStatus)
    }
  }
}
