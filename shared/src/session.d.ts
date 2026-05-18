// 中文：本文件（session.d.ts）位于 shared/src/session.d.ts，属于shared链路中的TypeScript 类型声明代码，连接上游调用方与下游执行逻辑。
// English: This file (session.d.ts) belongs to the shared typescript 类型声明 layer in shared/src/session.d.ts, wiring upstream callers with downstream runtime logic.

/**
 * 会话相关类型定义
 */
/** 会话 ID（品牌类型，增强类型安全） */
export type SessionId = string & {
    readonly __brand: 'SessionId';
};
/** 创建 SessionId */
export declare function createSessionId(id?: string): SessionId;
/** 序列化的 todo 项 */
export interface SerializedTodoItem {
    readonly content: string;
    readonly status: 'pending' | 'in_progress' | 'completed';
    readonly activeForm: string;
    readonly result?: string;
    readonly errorMessage?: string;
}
/** 会话快照（持久化用） */
export interface SessionSnapshot {
    readonly sessionId: string;
    readonly mode: 'simple' | 'plan';
    readonly contextMessages: Array<{
        role: string;
        content: string;
        timestamp?: number;
    }>;
    readonly todoItems: SerializedTodoItem[];
    readonly memoryTurnCounter: number;
    readonly createdAt: number;
    readonly lastActiveAt: number;
}
/** WS 连接参数（URL query 携带） */
export interface WsConnectParams {
    readonly sessionId: string;
}
