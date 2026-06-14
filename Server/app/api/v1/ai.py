from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.services.ai.assistant import AIAssistant

router = APIRouter(prefix="/api/ai", tags=["ai"])

_assistant = AIAssistant()


class AIContext(BaseModel):
    screen: str | None = None
    symbol: str | None = None
    date: str | None = None
    interval: str | None = None


class AITurn(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    context: AIContext | None = None
    history: list[AITurn] = Field(default_factory=list)


class AIChatResponse(BaseModel):
    reply: str
    tools_used: list[str] = Field(default_factory=list)


@router.get("/status")
async def ai_status():
    return {"enabled": _assistant.is_configured()}


@router.post("/chat", response_model=AIChatResponse)
async def ai_chat(
    body: AIChatRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _assistant.is_configured():
        raise HTTPException(status_code=503, detail="AI assistant is not configured on the server.")
    try:
        result = await _assistant.chat(
            body.message,
            context=body.context.model_dump() if body.context else None,
            history=[t.model_dump() for t in body.history],
            user_id=current_user.get("id"),
        )
        return AIChatResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")
