import logging

from langchain_core.tools import tool

from core.tools.tool_result import ToolResult

logger = logging.getLogger(__name__)


@tool
def execute_sql(sql: str, max_rows: int = 100) -> ToolResult:
    """执行 SQL 查询（仅支持 SELECT）。用于查询干部基本信息等数据库表。"""
    logger.info(f"执行 SQL 查询，最大行数: {max_rows}")
    logger.debug(f"SQL: {sql[:100]}...")

    try:
        from scripts.dm_executor import execute_sql_query
        result = execute_sql_query(sql, max_rows)
        logger.info(f"SQL 查询执行成功，长度: {len(result)} 字符")
        return ToolResult(
            context=result,
            display=f"```sql\n{sql}\n```\n",
        )
    except ImportError as e:
        error_msg = f"无法导入数据库执行器模块: {e}\n请确保 dmPython 驱动已安装并配置正确。"
        logger.error(error_msg)
        return f"错误: {error_msg}"
    except Exception as e:
        error_msg = f"SQL 执行失败: {e}"
        logger.error(error_msg)
        return f"错误: {error_msg}"
