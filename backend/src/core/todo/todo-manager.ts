// 中文：本文件（todo-manager.ts）位于 backend/src/core/todo/todo-manager.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (todo-manager.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/todo/todo-manager.ts, wiring upstream callers with downstream runtime logic.

/**
 * 带约束的任务列表管理器
 * 对应源码: core/todo/todo_manager.py
 */

/** 单个任务项 */
export interface TodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly activeForm: string
  readonly result?: string
  readonly errorMessage?: string
}

/** 任务更新输入 */
export interface TodoItemInput {
  content?: string
  status?: string
  activeForm?: string
  result?: string
  errorMessage?: string
}

const MAX_ITEMS = 20

export class TodoManager {
  private items: TodoItem[] = []

  /** 更新任务列表，返回渲染后的文本 */
  update(rawItems: TodoItemInput[]): string {
    const validated: TodoItem[] = []
    let inProgressCount = 0

    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i]
      const content = String(raw.content ?? '').trim()
      const status = String(raw.status ?? 'pending').toLowerCase()
      let activeForm = String(raw.activeForm ?? '').trim()

      if (!content) {
        throw new Error(`第 ${i} 条：需要 content`)
      }
      if (!activeForm) {
        activeForm = `正在执行: ${content.slice(0, 20)}`
      }
      if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') {
        throw new Error(`第 ${i} 条：无效的 status`)
      }
      if (status === 'in_progress') {
        inProgressCount++
      }

      validated.push({
        content,
        status: status as TodoItem['status'],
        activeForm,
        result: typeof raw.result === 'string' ? raw.result : undefined,
        errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined,
      })
    }

    if (inProgressCount > 1) {
      throw new Error('一次只能有一个任务是 in_progress')
    }

    this.items = validated.slice(0, MAX_ITEMS)
    return this.render()
  }

  /** 渲染任务列表为文本 */
  render(): string {
    if (this.items.length === 0) {
      return '没有 todos。'
    }

    const lines = this.items.map((t) => {
      const mark =
        t.status === 'completed' ? '[x]' :
        t.status === 'in_progress' ? '[>]' : '[ ]'
      return `${mark} ${t.content}`
    })

    const done = this.items.filter((t) => t.status === 'completed').length
    return lines.join('\n') + `\n(${done}/${this.items.length} 已完成)`
  }

  /** 返回第一个 pending item 的 [index, item]，无则返回 null */
  getPending(): [number, TodoItem] | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].status === 'pending') {
        return [i, this.items[i]]
      }
    }
    return null
  }

  /** 返回第一个 in_progress item 的 [index, item]，无则返回 null */
  getInProgress(): [number, TodoItem] | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].status === 'in_progress') {
        return [i, this.items[i]]
      }
    }
    return null
  }

  /** 标记指定索引的任务为 in_progress */
  markInProgress(index: number): void {
    this.items = this.items.map((item, i) =>
      i === index ? { ...item, status: 'in_progress' as const } : item
    )
  }

  /** 标记指定索引的任务为 completed */
  markCompleted(index: number, result?: string, errorMessage?: string): void {
    this.items = this.items.map((item, i) =>
      i === index
        ? {
            ...item,
            status: 'completed' as const,
            result: result ?? item.result,
            errorMessage: errorMessage ?? item.errorMessage,
          }
        : item
    )
  }

  /** 判断是否所有任务已完成 */
  allDone(): boolean {
    return this.items.every((item) => item.status === 'completed')
  }

  /** 获取所有任务项（序列化用） */
  getItems(): readonly TodoItem[] {
    return this.items
  }

  /** 加载任务项（反序列化用） */
  loadItems(items: TodoItem[]): void {
    this.items = items.slice(0, MAX_ITEMS)
  }
}

/** 创建会话级 TodoManager 实例 */
export function createTodoManager(): TodoManager {
  return new TodoManager()
}
