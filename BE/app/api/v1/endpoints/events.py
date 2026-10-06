import asyncio
from typing import AsyncGenerator
from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, require_manager_or_admin
from app.core.events import event_bus
from app.models.user import User
from app.schemas.event import (
    create_inventory_updated_event,
)

router = APIRouter()

HEARTBEAT_INTERVAL_SECONDS = 15.0


@router.get("/events")
async def stream_events(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Endpoint luồng dữ liệu thời gian thực Server-Sent Events (SSE).

    Quy cách kỹ thuật:
    - Xác thực: Yêu cầu JWT hợp lệ trong header 'Authorization: Bearer <token>' (trả về 401 nếu lỗi).
    - Chuẩn contract:
        id: <số nguyên tăng dần>
        event: <loại sự kiện>
        data: <chuỗi json>
    - Nhịp tim (Heartbeat): comment ': ping\\n\\n' phát ra mỗi 15 giây khi không có sự kiện mới.
    - Headers đặc thù:
        Cache-Control: no-cache
        Connection: keep-alive
        X-Accel-Buffering: no
    - Quản lý kết nối:
        - Tối đa 5 kết nối đồng thời trên mỗi user (vượt quá sẽ đóng kết nối cũ nhất).
        - Tự động hủy đăng ký và dọn sạch hàng đợi khi client ngắt kết nối (không rò rỉ RAM).
    """
    queue = await event_bus.subscribe(user_id=current_user.email)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # Gửi lời chào xác nhận kết nối thành công ban đầu
            yield ": connected\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS
                    )
                    # Nếu gặp tín hiệu sentinel None: kết nối bị đóng do vượt quá số tab tối đa
                    if event is None:
                        yield 'event: close\ndata: {"reason":"connection_limit_exceeded"}\n\n'
                        break

                    yield event.to_sse_message()
                except asyncio.TimeoutError:
                    # Gửi heartbeat định kỳ để giữ kết nối không bị timeout
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            # Client chủ động tắt tab hoặc ngắt mạng
            pass
        finally:
            await event_bus.unsubscribe(user_id=current_user.email, queue=queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/events/publish-test", status_code=status.HTTP_200_OK)
async def publish_test_event(
    sku_id: str,
    current_user: User = Depends(require_manager_or_admin),
):
    """
    API hỗ trợ lập trình viên/tester bắn thử sự kiện inventory.updated
    khi chưa có giao diện hoặc UC13. Chỉ dành cho Warehouse Manager và Admin.
    """
    event = create_inventory_updated_event(sku_id=sku_id, actor_id=current_user.email)
    await event_bus.publish(event)
    return {
        "status": "success",
        "message": f"Đã phát sự kiện cho SKU '{sku_id}'",
        "event_id": event.id,
    }

