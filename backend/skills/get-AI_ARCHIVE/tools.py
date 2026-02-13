import json
import logging
import httpx
from langchain_core.tools import tool
from core.tools.tool_result import ToolResult

logger = logging.getLogger(__name__)

# 硬编码（后续移至配置）
API_BASE_URL = "http://192.168.3.42:8085"
AUTH_TOKEN = "Bearer eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl9leHBpcmVfdGltZSI6MTc2NzUzMzc5MjU3NCwiZXhwIjoxNzY3NjE4MzkyLCJsb2dpbl91c2VyX2tleSI6IjdjYjQ0YWNjMWNjZTRmMDc5NTA3MDQ4ZjZlOTM2YTdhIn0.2eh-_HOyzHvXo1Ygi_8KrfgJwXEEW0wdhsSMSs-mgsYUlkl70GvyqQapSqXUUwvwweKLj9HAanoyovxfzWgjew"


@tool
def get_ai_archive_data(archive_id: str, scheme_id: str) -> ToolResult:
    """根据档案ID和方案ID，获取AI档案的详细业务数据。

    Args:
        archive_id: 档案唯一标识 (ARCHIVEID)
        scheme_id: 方案唯一标识 (AISCHEMEID)
    """
    url = f"{API_BASE_URL}/api/archive/get2"
    params = {"archiveId": archive_id, "schemeId": scheme_id}
    headers = {"Authorization": AUTH_TOKEN}

    logger.info(f"请求AI档案: archive_id={archive_id}, scheme_id={scheme_id}")

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, params=params, headers=headers)

        if response.status_code != 200:
            return f"错误: API 返回 {response.status_code}: {response.text[:200]}"

        data = response.json().get("data", {})
        result_json = json.dumps(data, ensure_ascii=False, indent=2)

        # 截取前50字符给前端展示
        display = result_json[:500] + "...(截取500字符)\n\n" if len(result_json) > 50 else result_json

        return ToolResult(
            context=result_json,
            display=display,
        )

    except httpx.TimeoutException:
        return "错误: 请求档案 API 超时"
    except Exception as e:
        return f"错误: {e}"
