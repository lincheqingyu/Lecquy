/**
 * 主代理循环状态定义
 * 对应源码: agents/agent_loop/state.py
 * 变更：去掉 model_type / skill_model_type
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

/** 单个任务项（用于状态中的 todos） */
export interface TodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly activeForm: string
}

export const AgentLoopAnnotation = Annotation.Root({
  /** 用户问题 */
  userQuery: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => '',
  }),

  /** 总消息记录 */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /** 任务列表 */
  todos: Annotation<TodoItem[]>({
    reducer: (_prev: TodoItem[], next: TodoItem[]) => next,
    default: () => [],
  }),

  /** 总迭代次数 */
  iteration: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),

  /** 本轮 LLM 调用耗时（毫秒） */
  elapsedMs: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),

  /** token 消耗 */
  tokenUsage: Annotation<Record<string, number>>({
    reducer: (_prev: Record<string, number>, next: Record<string, number>) => next,
    default: () => ({}),
  }),

  /** 动态追加的 skill tool 名称 */
  extraToolNames: Annotation<string[]>({
    reducer: (_prev: string[], next: string[]) => next,
    default: () => [],
  }),

  /** 工具调用失败次数（单次提问内累计） */
  toolFailCount: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),

  /** 本轮工具执行后是否直接返回（跳过 LLM 总结） */
  directReturn: Annotation<boolean>({
    reducer: (_prev: boolean, next: boolean) => next,
    default: () => false,
  }),
})

/** 主代理循环状态类型 */
export type AgentLoopState = typeof AgentLoopAnnotation.State
