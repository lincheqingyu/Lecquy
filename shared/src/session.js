// 中文：本文件（session.js）位于 shared/src/session.js，属于shared链路中的共享类型代码，连接上游调用方与下游执行逻辑。
// English: This file (session.js) belongs to the shared 共享类型 layer in shared/src/session.js, wiring upstream callers with downstream runtime logic.

/**
 * 会话相关类型定义
 */
/** 创建 SessionId */
export function createSessionId(id) {
    return (id ?? generateId());
}
/** 生成随机 ID */
function generateId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
//# sourceMappingURL=session.js.map
