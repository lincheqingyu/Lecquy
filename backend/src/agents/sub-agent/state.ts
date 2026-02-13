/**
 * 子代理状态定义
 * 对应源码: agents/sub_agent/state.py
 * 变更：去掉 model_type / skill_model_type / sub_agent_type
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

export const SubAgentAnnotation = Annotation.Root({
  /** 消息历史 */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /** 总循环次数 */
  iteration: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),

  /** 最大迭代次数，防无限循环 */
  maxIterations: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 8,
  }),

  /** 工具失败次数 */
  toolFailCount: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),

  /** 任务描述（用于返回上下文） */
  description: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => '',
  }),

  /** 动态追加的 skill tool 名称 */
  extraToolNames: Annotation<string[]>({
    reducer: (_prev: string[], next: string[]) => next,
    default: () => [],
  }),
})

/** 子代理状态类型 */
export type SubAgentState = typeof SubAgentAnnotation.State
