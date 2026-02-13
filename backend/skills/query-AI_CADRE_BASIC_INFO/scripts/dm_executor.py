# -*- coding: utf-8 -*-
"""
dm_executor.py - 达梦数据库执行器模块

提供达梦数据库（DM8）的连接、SQL 执行和结果格式化功能
用于 query-AI_CADRE_BASIC_INFO 技能的数据库操作
"""

import os
import json
import logging
from typing import Dict, List, Any, Tuple
from datetime import date, datetime
from decimal import Decimal


logger = logging.getLogger(__name__)


class DMDatabaseExecutor:
    """
    达梦数据库连接与执行器
    
    负责与达梦数据库建立连接、执行 SQL 查询以及格式化结果
    """

    def __init__(self, db_config: Dict[str, Any] | None = None):
        """
        初始化达梦数据库执行器
        
        Args:
            db_config: 数据库配置字典（可选），如果不提供则从环境变量读取
                包含字段: user, password, server, port, schema
        """
        if db_config is None:
            db_config = self._load_config_from_env()
        
        self.db_config = db_config
        self.conn = None
        self._connect()

    def _load_config_from_env(self) -> Dict[str, Any]:
        """
        从环境变量加载数据库配置
        
        Returns:
            Dict[str, Any]: 数据库配置字典
        
        Raises:
            ValueError: 如果缺少必需的环境变量
        """
        # required_vars = ["DM_HOST", "DM_PORT", "DM_USER", "DM_PASSWORD"]
        # missing_vars = [var for var in required_vars if not os.getenv(var)]
        #
        # if missing_vars:
        #     raise ValueError(
        #         f"缺少必需的环境变量: {', '.join(missing_vars)}\n"
        #         f"请在 .env 文件中配置 DM8 数据库连接信息"
        #     )
        
        # config = {
        #     "server": os.getenv("DM_HOST"),
        #     "port": int(os.getenv("DM_PORT")),
        #     "user": os.getenv("DM_USER"),
        #     "password": os.getenv("DM_PASSWORD"),
        # }

        config = {
            "server": "192.168.3.42",
            "port": "5236",
            "user": "ARCH_AI",
            "password": "ARCH12345",
            "schema": "ARCH_AI"
        }
        
        # schema 是可选的
        # if os.getenv("DM_SCHEMA"):
        #     config["schema"] = os.getenv("DM_SCHEMA")
        
        logger.info(f"从环境变量加载 DM8 配置: {config['server']}:{config['port']}")
        return config

    def _connect(self):
        """
        建立到达梦数据库的连接
        
        使用 dmPython 驱动连接数据库，并可选设置默认 schema
        
        Raises:
            Exception: 如果 dmPython 驱动未安装或数据库连接失败
        """
        try:
            import dmPython
            
            logger.info(f"正在连接达梦数据库: {self.db_config['server']}:{self.db_config['port']}")
            
            self.conn = dmPython.connect(
                user=self.db_config["user"],
                password=self.db_config["password"],
                server=self.db_config["server"],
                port=self.db_config["port"]
            )
            
            # 如果配置中指定了 schema，则设置当前会话的 schema
            if "schema" in self.db_config:
                cursor = self.conn.cursor()
                try:
                    cursor.execute(f"SET SCHEMA {self.db_config['schema']}")
                    logger.info(f"已设置 schema: {self.db_config['schema']}")
                finally:
                    cursor.close()
            
            logger.info("数据库连接成功")
            
        except ImportError:
            error_msg = (
                "未找到 dmPython 驱动，请先安装。\n"
                "安装命令: pip install dmPython"
            )
            logger.error(error_msg)
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"数据库连接失败: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def execute(self, sql: str) -> Tuple[List[Tuple], List[str]]:
        """
        执行 SQL 查询语句
        
        Args:
            sql: 要执行的 SQL 语句（仅支持 SELECT 查询）
        
        Returns:
            Tuple[List[Tuple], List[str]]: (查询结果行, 列名列表)
        
        Raises:
            ValueError: 如果 SQL 不是 SELECT 语句
            Exception: 如果 SQL 执行失败
        """
        # 安全检查：仅允许 SELECT 语句
        sql_upper = sql.strip().upper()
        if not sql_upper.startswith("SELECT"):
            raise ValueError("安全限制：仅允许执行 SELECT 查询语句")
        
        # 禁止危险操作
        dangerous_keywords = ["DROP", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "ALTER"]
        if any(keyword in sql_upper for keyword in dangerous_keywords):
            raise ValueError(f"安全限制：SQL 中包含禁止的关键字")
        
        logger.info(f"执行 SQL: {sql[:100]}...")
        
        cursor = self.conn.cursor()
        try:
            cursor.execute(sql)
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            
            logger.info(f"查询成功，返回 {len(rows)} 行，{len(columns)} 列")
            return rows, columns
        except Exception as e:
            error_msg = f"SQL 执行失败: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)
        finally:
            cursor.close()

    def execute_and_format(self, sql: str, max_rows: int = 100) -> str:
        """
        执行 SQL 并格式化结果为 JSON 字符串
        
        Args:
            sql: 要执行的 SQL 语句
            max_rows: 最大返回行数（防止结果过大）
        
        Returns:
            str: JSON 格式的查询结果
        """
        try:
            rows, columns = self.execute(sql)
            
            # 限制返回行数
            if len(rows) > max_rows:
                logger.warning(f"结果行数 {len(rows)} 超过限制 {max_rows}，将截断")
                rows = rows[:max_rows]
                truncated = True
            else:
                truncated = False
            
            # 转换为字典列表
            result_list = []
            for row in rows:
                row_dict = {}
                for col_name, col_value in zip(columns, row):
                    # 处理特殊类型
                    if isinstance(col_value, (date, datetime)):
                        row_dict[col_name] = col_value.isoformat()
                    elif isinstance(col_value, Decimal):
                        row_dict[col_name] = float(col_value)
                    elif col_value is None:
                        row_dict[col_name] = None
                    else:
                        row_dict[col_name] = str(col_value)
                result_list.append(row_dict)
            
            # 构建响应
            response = {
                "success": True,
                "row_count": len(result_list),
                "total_rows": len(rows) if not truncated else f"{len(rows)}+（已截断）",
                "columns": columns,
                "data": result_list,
                "truncated": truncated
            }
            
            return json.dumps(response, ensure_ascii=False, indent=2)
        
        except Exception as e:
            logger.error(f"执行并格式化失败: {e}")
            error_response = {
                "success": False,
                "error": str(e),
                "sql": sql[:200]  # 只返回 SQL 前 200 字符
            }
            return json.dumps(error_response, ensure_ascii=False, indent=2)

    def get_schema(self, tables: List[str]) -> Dict[str, List[Dict[str, str]]]:
        """
        获取指定表的结构信息
        
        Args:
            tables: 待获取结构信息的表名列表
        
        Returns:
            Dict[str, List[Dict[str, str]]]: 包含每个表的列名和数据类型的字典
        """
        cursor = self.conn.cursor()
        result = {}
        try:
            # 获取数据库所有者，如果未指定 schema，则使用用户名
            owner = self.db_config.get('schema', self.db_config['user'])
            
            for table in tables:
                # 查询 ALL_TAB_COLUMNS 视图以获取表的列信息
                query = f"""
                    SELECT COLUMN_NAME, DATA_TYPE 
                    FROM ALL_TAB_COLUMNS 
                    WHERE OWNER='{owner}' AND TABLE_NAME='{table}'
                """
                cursor.execute(query)
                
                # 将查询结果转换为字典格式
                result[table] = [
                    {"name": row[0], "type": row[1]} 
                    for row in cursor.fetchall()
                ]
            
            logger.info(f"获取表结构成功: {list(result.keys())}")
            return result
        except Exception as e:
            logger.error(f"获取表结构失败: {e}")
            raise
        finally:
            cursor.close()

    def close(self):
        """关闭数据库连接"""
        if self.conn:
            self.conn.close()
            logger.info("数据库连接已关闭")

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器退出时关闭连接"""
        self.close()


# 全局单例实例（延迟初始化）
_executor_instance = None


def get_executor() -> DMDatabaseExecutor:
    """
    获取全局数据库执行器实例（单例模式）
    
    Returns:
        DMDatabaseExecutor: 数据库执行器实例
    """
    global _executor_instance
    if _executor_instance is None:
        _executor_instance = DMDatabaseExecutor()
    return _executor_instance


def execute_sql_query(sql: str, max_rows: int = 100) -> str:
    """
    执行 SQL 查询的便捷函数（供工具调用）
    
    Args:
        sql: SQL 查询语句
        max_rows: 最大返回行数
    
    Returns:
        str: JSON 格式的查询结果
    """
    try:
        executor = get_executor()
        return executor.execute_and_format(sql, max_rows)
    except Exception as e:
        logger.error(f"SQL 查询执行失败: {e}")
        error_response = {
            "success": False,
            "error": f"执行失败: {str(e)}"
        }
        return json.dumps(error_response, ensure_ascii=False, indent=2)
