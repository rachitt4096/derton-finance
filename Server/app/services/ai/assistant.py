from __future__ import annotations

import asyncio
import json

import boto3
from botocore.config import Config

from app.config import settings
from app.core.logging import logger
from app.services.ai.tools import TOOL_SPECS, run_tool

SYSTEM_PROMPT = (
    "You are the Derton Finance terminal assistant. You help an analyst explore "
    "Indian (NSE/BSE) market data. You can pull OHLCV candles (minute-by-minute and "
    "multi-day daily history), latest quotes, company fundamentals, and search the web "
    "for news. For a 'study'/'analyse this company' request, combine tools: fundamentals "
    "(get_company_fundamentals), the price trend over the period (get_market_candles with "
    "interval=1d and the right days window, e.g. days=30), and recent news (web_search); "
    "then summarise valuation, the period's price action, and catalysts. "
    "You can also create price alerts (per company, the user's watchlist, or all "
    "NIFTY 50 stocks) when asked to notify/alert them about a price or % move. "
    "DEEP ANALYSIS: When asked to study, explain a move, or find patterns, reason in steps: "
    "(1) call find_notable_moves to locate the standout sessions (big moves, gaps, volume "
    "spikes) and their dates; (2) for each key date, web_search news around that date to "
    "identify the catalyst (earnings, orders, regulatory, macro, sector); (3) connect cause "
    "to effect explicitly ('on <date> the stock did X, likely because <news>'); "
    "(4) call out RECURRING patterns — e.g. repeated gap-ups after results, support/resistance "
    "levels that hold, volume spikes preceding moves, day-of-week or event-driven seasonality. "
    "State your confidence and separate fact (data/news) from inference. "
    "Use tools whenever a question needs real data — never invent prices, news, or causes. "
    "Be concise and quantitative: lead with the numbers, then a short interpretation. "
    "When the user references 'this stock' or 'this date' use the provided context. "
    "Format prices in INR. Keep answers tight and terminal-friendly.\n\n"
    "LANGUAGE: Detect the user's language and reply in the same one. If they write in "
    "Hindi (Devanagari) reply in Hindi, if they write in Hinglish (Hindi in Roman script) "
    "reply in Hinglish, otherwise reply in English. Keep stock symbols, numbers, and "
    "technical terms (LTP, VWAP, OI, PCR) in English/Latin script even within Hindi replies."
)


class AIAssistant:
    def __init__(self) -> None:
        self._client = None

    def is_configured(self) -> bool:
        return bool(settings.AI_ENABLED and settings.BEDROCK_MODEL_ID.strip())

    def _bedrock(self):
        if self._client is None:
            region = settings.BEDROCK_REGION.strip() or settings.AWS_REGION
            kwargs = {"region_name": region, "config": Config(read_timeout=60, retries={"max_attempts": 2})}
            if settings.AWS_ACCESS_KEY_ID.strip() and settings.AWS_SECRET_ACCESS_KEY.strip():
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID.strip()
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY.strip()
            self._client = boto3.client("bedrock-runtime", **kwargs)
        return self._client

    async def chat(
        self,
        message: str,
        context: dict | None = None,
        history: list[dict] | None = None,
        user_id: str | None = None,
    ) -> dict:
        if not self.is_configured():
            raise ValueError("AI assistant is not configured (set AI_ENABLED and BEDROCK_MODEL_ID).")

        ctx_lines = []
        if context:
            for key in ("screen", "symbol", "date", "interval"):
                if context.get(key):
                    ctx_lines.append(f"- current {key}: {context[key]}")
        context_block = ("Current terminal context:\n" + "\n".join(ctx_lines)) if ctx_lines else ""

        messages: list[dict] = []
        for turn in (history or [])[-6:]:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            text = str(turn.get("content", "")).strip()
            if text:
                messages.append({"role": role, "content": [{"text": text}]})

        user_text = message if not context_block else f"{context_block}\n\nQuestion: {message}"
        messages.append({"role": "user", "content": [{"text": user_text}]})

        tool_config = {"tools": TOOL_SPECS}
        used_tools: list[str] = []

        for _ in range(max(1, settings.AI_MAX_TOOL_ITERATIONS)):
            response = await asyncio.to_thread(
                self._bedrock().converse,
                modelId=settings.BEDROCK_MODEL_ID.strip(),
                messages=messages,
                system=[{"text": SYSTEM_PROMPT}],
                toolConfig=tool_config,
                inferenceConfig={"maxTokens": settings.AI_MAX_TOKENS, "temperature": 0.2},
            )

            output_message = response["output"]["message"]
            messages.append(output_message)
            stop_reason = response.get("stopReason")

            if stop_reason != "tool_use":
                text = "".join(
                    block.get("text", "") for block in output_message.get("content", []) if "text" in block
                ).strip()
                return {"reply": text, "tools_used": used_tools}

            # Execute every requested tool and feed results back.
            tool_result_blocks = []
            for block in output_message.get("content", []):
                tool_use = block.get("toolUse")
                if not tool_use:
                    continue
                name = tool_use["name"]
                used_tools.append(name)
                logger.info("AI tool call", tool=name, input=tool_use.get("input"))
                result_json = await run_tool(name, tool_use.get("input") or {}, user_id)
                tool_result_blocks.append(
                    {
                        "toolResult": {
                            "toolUseId": tool_use["toolUseId"],
                            "content": [{"text": result_json}],
                        }
                    }
                )

            messages.append({"role": "user", "content": tool_result_blocks})

        return {
            "reply": "I gathered data but hit the tool-call limit before finishing. Try narrowing the question.",
            "tools_used": used_tools,
        }
