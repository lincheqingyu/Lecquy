// 中文：本文件（ws-events.d.ts）位于 shared/src/ws-events.d.ts，属于shared链路中的TypeScript 类型声明代码，连接上游调用方与下游执行逻辑。
// English: This file (ws-events.d.ts) belongs to the shared typescript 类型声明 layer in shared/src/ws-events.d.ts, wiring upstream callers with downstream runtime logic.

/**
 * WebSocket 事件类型定义
 * 前后端共享，确保事件名和 payload 类型一致
 */
import type { SerializedTodoItem } from './session.js';
/** 服务端 → 客户端 事件类型 */
export type ServerEventType = 'message_delta' | 'message_end' | 'tool_start' | 'tool_end' | 'plan_created' | 'worker_start' | 'worker_delta' | 'worker_end' | 'todo_update' | 'need_user_input' | 'done' | 'error' | 'ping' | 'session_restored';
/** 客户端 → 服务端 事件类型 */
export type ClientEventType = 'chat' | 'cancel' | 'pong';
/** 服务端事件 payload 映射 */
export interface ServerEventPayloadMap {
    message_delta: {
        content: string;
    };
    message_end: Record<string, never>;
    tool_start: {
        toolName: string;
        args?: unknown;
    };
    tool_end: {
        toolName: string;
        isError?: boolean;
        summary: string;
    };
    plan_created: {
        todos: SerializedTodoItem[];
    };
    worker_start: {
        todoIndex: number;
        content: string;
        activeForm: string;
    };
    worker_delta: {
        todoIndex: number;
        content: string;
    };
    worker_end: {
        todoIndex: number;
        result: string;
        isError: boolean;
    };
    todo_update: {
        todos: SerializedTodoItem[];
    };
    need_user_input: {
        prompt: string;
    };
    done: Record<string, never>;
    error: {
        message: string;
    };
    ping: {
        timestamp: number;
    };
    session_restored: {
        sessionId: string;
        messageCount: number;
    };
}
/** 客户端事件 payload 映射 */
export interface ClientEventPayloadMap {
    chat: {
        mode: 'simple' | 'plan';
        messages: Array<{
            role: string;
            content: string;
        }>;
        model?: string;
        baseUrl?: string;
        apiKey?: string;
        enableTools?: boolean;
        options?: {
            temperature?: number;
            maxTokens?: number;
        };
    };
    cancel: Record<string, never>;
    pong: {
        timestamp: number;
    };
}
/** 服务端发送的事件 */
export interface ServerEvent<T extends ServerEventType = ServerEventType> {
    readonly event: T;
    readonly payload: ServerEventPayloadMap[T];
}
/** 客户端发送的事件 */
export interface ClientEvent<T extends ClientEventType = ClientEventType> {
    readonly event: T;
    readonly payload: ClientEventPayloadMap[T];
}
