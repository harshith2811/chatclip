"""
Centralized Gemini AI Service Abstraction.
Handles header-only authentication (x-goog-api-key), rate limiting, transient retries,
prompt-injection delimiters/sanitization, JSON schema validation, and SQLite telemetry.

This service is strictly advisory and has zero authority to mutate rights or approval states.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import os
import random
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger("yt_clipping.scoring.gemini_service")

FENCE_REGEX = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DELIMITER_TAG_RE = re.compile(r"</?\s*UNTRUSTED_SOURCE_DATA\b[^>]*>", re.IGNORECASE)
_GEMINI_KEY_PATTERN = re.compile(r"AIza[0-9A-Za-z_\-]{10,}")


class GeminiServiceError(RuntimeError):
    """Raised when a centralized Gemini request fails or returns invalid structured output."""


def mask_secrets(text: str, extra_secrets: Sequence[str] = ()) -> str:
    """Redacts API keys or supplied secrets from logs and error strings."""
    if not text:
        return ""
    masked = _GEMINI_KEY_PATTERN.sub("[REDACTED_KEY]", str(text))
    for secret in extra_secrets:
        if secret and len(secret) >= 6:
            masked = masked.replace(secret, "[REDACTED]")
    masked = re.sub(r"([?&]key=)[^&\s]+", r"\1[REDACTED]", masked, flags=re.IGNORECASE)
    return masked


def sanitize_untrusted_text(text: Any, max_len: int = 12000) -> str:
    """
    Normalizes untrusted external content (video titles, descriptions, transcripts, comments)
    and neutralizes embedded prompt-delimiter tags before injecting into prompts.
    """
    if text is None:
        return ""
    raw = str(text)
    cleaned = _CONTROL_CHAR_RE.sub("", raw)
    cleaned = _DELIMITER_TAG_RE.sub("[filtered-delimiter]", cleaned)
    if max_len > 0 and len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip() + "... [truncated]"
    return cleaned.strip()


def wrap_untrusted_source(label: str, text: Any, max_len: int = 12000) -> str:
    """Wraps untrusted source text inside explicit XML-style isolation delimiters."""
    safe_label = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(label or "source"))[:48]
    sanitized = sanitize_untrusted_text(text, max_len=max_len)
    return f'<UNTRUSTED_SOURCE_DATA name="{safe_label}">\n{sanitized}\n</UNTRUSTED_SOURCE_DATA>'


def extract_json_payload(raw_text: str) -> Any:
    """Extracts structured JSON from either a Gemini API envelope or raw JSON/fenced text."""
    if raw_text is None:
        raise ValueError("Empty response text")
    text = str(raw_text).strip()
    if not text:
        raise ValueError("Blank response text")

    # Unwrap Gemini REST envelope if raw response JSON was supplied
    try:
        top = json.loads(text)
        if isinstance(top, dict) and "candidates" in top and isinstance(top["candidates"], list):
            parts = (
                top["candidates"][0].get("content", {}).get("parts", [])
                if top["candidates"]
                else []
            )
            extracted = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))
            if extracted.strip():
                text = extracted.strip()
        elif isinstance(top, (dict, list)) and (
            "candidates" not in top or not isinstance(top.get("candidates"), list)
        ):
            return top
    except json.JSONDecodeError:
        pass

    fence_match = FENCE_REGEX.search(text)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Attempt balanced slice extraction for first object or array
    obj_start, obj_end = text.find("{"), text.rfind("}")
    arr_start, arr_end = text.find("["), text.rfind("]")
    candidates: List[str] = []
    if obj_start != -1 and obj_end > obj_start:
        candidates.append(text[obj_start : obj_end + 1])
    if arr_start != -1 and arr_end > arr_start:
        candidates.append(text[arr_start : arr_end + 1])
    for snippet in sorted(candidates, key=len, reverse=True):
        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            continue
    raise ValueError("Failed to parse JSON payload from Gemini output")


class ThreadSafeRateLimiter:
    """Thread-safe token-bucket rate limiter capped by requests per minute."""

    def __init__(self, requests_per_minute: int = 30) -> None:
        self.requests_per_minute = max(1, int(requests_per_minute or 30))
        self.capacity = float(self.requests_per_minute)
        self.tokens = self.capacity
        self.refill_per_sec = self.capacity / 60.0
        self._lock = threading.Lock()
        self._last_refill = time.monotonic()

    def acquire(self) -> None:
        wait_seconds = 0.0
        with self._lock:
            now = time.monotonic()
            elapsed = max(0.0, now - self._last_refill)
            self._last_refill = now
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_sec)
            if self.tokens >= 1.0:
                self.tokens -= 1.0
            else:
                deficit = 1.0 - self.tokens
                wait_seconds = deficit / self.refill_per_sec
                self.tokens = 0.0
        if wait_seconds > 0.0:
            time.sleep(wait_seconds)


@dataclass
class GeminiResult:
    text: str
    parsed_json: Optional[Any]
    model: str
    prompt_version: str
    latency_ms: float
    input_tokens: int = 0
    output_tokens: int = 0
    raw_response: Optional[Dict[str, Any]] = None


class GeminiService:
    """Centralized REST client for Gemini API with security hardening and telemetry."""

    DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
    DEFAULT_MODEL = "gemini-2.5-flash"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        api_base: Optional[str] = None,
        timeout: int = 25,
        max_retries: int = 2,
        offline_mode: bool = False,
        db_path: Optional[str] = None,
        requests_per_minute: int = 30,
        config: Optional[Any] = None,
    ) -> None:
        raw_key = (
            api_key
            or (getattr(config, "gemini_api_key", None) if config else None)
            or (getattr(config, "llm_api_key", None) if config else None)
            or (config.get("gemini_api_key") if isinstance(config, dict) else None)
            or (config.get("llm_api_key") if isinstance(config, dict) else None)
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
            or ""
        )
        self.api_key = str(raw_key).strip()

        raw_model = (
            model
            or (getattr(config, "gemini_model", None) if config else None)
            or (config.get("gemini_model") if isinstance(config, dict) else None)
            or os.getenv("GEMINI_MODEL")
            or os.getenv("LLM_MODEL")
            or self.DEFAULT_MODEL
        )
        self.model = str(raw_model).strip() or self.DEFAULT_MODEL

        raw_base = (
            api_base
            or (getattr(config, "gemini_api_base", None) if config else None)
            or (config.get("gemini_api_base") if isinstance(config, dict) else None)
            or os.getenv("GEMINI_API_BASE")
            or self.DEFAULT_API_BASE
        )
        self.api_base = str(raw_base).rstrip("/")
        self.timeout = max(1, int(timeout))
        self.max_retries = max(0, int(max_retries))
        raw_offline = (
            offline_mode
            or (getattr(config, "offline_mode", False) if config else False)
            or (config.get("offline_mode", False) if isinstance(config, dict) else False)
            or os.getenv("GEMINI_OFFLINE_MODE", "").lower() in ("true", "1", "yes")
            or os.getenv("OFFLINE_MODE", "").lower() in ("true", "1", "yes")
        )
        self.offline_mode = bool(raw_offline)
        self.db_path = db_path or (getattr(config, "db_path", None) if config else None)
        self.rate_limiter = ThreadSafeRateLimiter(requests_per_minute=requests_per_minute)

    @property
    def is_available(self) -> bool:
        return bool(self.api_key) and not self.offline_mode

    def _build_endpoint_url(self, model_name: Optional[str] = None) -> str:
        chosen_model = (model_name or self.model).strip()
        if chosen_model.startswith("models/"):
            chosen_model = chosen_model[len("models/") :]
        return f"{self.api_base}/models/{chosen_model}:generateContent"

    def _log_usage(
        self,
        *,
        capability: str,
        model: str,
        prompt_version: str,
        status: str,
        latency_ms: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
        error_type: str = "",
    ) -> None:
        if not self.db_path or self.db_path == ":memory:" or not os.path.exists(self.db_path):
            return
        try:
            conn = sqlite3.connect(self.db_path, timeout=5.0)
            try:
                conn.execute(
                    """
                    INSERT INTO gemini_usage_log
                    (capability, model, prompt_version, status, latency_ms, input_tokens, output_tokens, error_type, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(capability)[:64],
                        str(model)[:64],
                        str(prompt_version)[:32],
                        str(status)[:32],
                        round(float(latency_ms), 2),
                        int(input_tokens or 0),
                        int(output_tokens or 0),
                        mask_secrets(error_type, (self.api_key,))[:120],
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        except Exception:
            # Telemetry failure must never interrupt callers
            pass

    def _http_post_json(self, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if "?key=" in url or "&key=" in url:
            raise GeminiServiceError("API keys must never be sent in query parameters.")
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
            "User-Agent": "yt-clipping-intelligence/2.0",
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)

    def generate_content(
        self,
        prompt: str,
        *,
        capability: str = "general",
        prompt_version: str = "v1",
        model: Optional[str] = None,
        system_instruction: Optional[str] = None,
        response_mime_type: Optional[str] = None,
        temperature: float = 0.35,
        max_output_tokens: int = 2048,
        required_keys: Optional[Sequence[str]] = None,
        expect_json: bool = False,
    ) -> GeminiResult:
        if not self.is_available:
            raise GeminiServiceError("GeminiService is unavailable (offline mode or API key not configured).")

        chosen_model = (model or self.model).strip()
        url = self._build_endpoint_url(chosen_model)
        payload: Dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": str(prompt)}]}],
            "generationConfig": {
                "temperature": float(temperature),
                "maxOutputTokens": int(max_output_tokens),
            },
        }
        if response_mime_type:
            payload["generationConfig"]["responseMimeType"] = response_mime_type
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": str(system_instruction)}]}

        last_error: Optional[Exception] = None
        last_http_error: Optional[Exception] = None
        start_t = time.perf_counter()

        for attempt in range(self.max_retries + 1):
            try:
                self.rate_limiter.acquire()
                raw_resp = self._http_post_json(url, payload)
                latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)

                candidates = raw_resp.get("candidates") or []
                text = ""
                if candidates and isinstance(candidates[0], dict):
                    parts = candidates[0].get("content", {}).get("parts", []) or []
                    text = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict)).strip()

                if not text and candidates:
                    finish_reason = candidates[0].get("finishReason", "")
                    raise GeminiServiceError(f"Gemini returned empty text (finishReason={finish_reason})")
                if not text and not candidates:
                    raise GeminiServiceError("Gemini returned no candidates.")

                usage = raw_resp.get("usageMetadata") or {}
                in_tokens = int(usage.get("promptTokenCount") or 0)
                out_tokens = int(usage.get("candidatesTokenCount") or 0)

                parsed_json: Optional[Any] = None
                if expect_json or required_keys:
                    parsed_json = extract_json_payload(text)
                    if required_keys:
                        if not isinstance(parsed_json, dict):
                            raise GeminiServiceError("Expected JSON object matching required schema.")
                        missing = [k for k in required_keys if k not in parsed_json]
                        if missing:
                            raise GeminiServiceError(f"Gemini JSON missing required keys: {', '.join(missing)}")

                self._log_usage(
                    capability=capability,
                    model=chosen_model,
                    prompt_version=prompt_version,
                    status="OK",
                    latency_ms=latency_ms,
                    input_tokens=in_tokens,
                    output_tokens=out_tokens,
                )
                return GeminiResult(
                    text=text,
                    parsed_json=parsed_json,
                    model=chosen_model,
                    prompt_version=prompt_version,
                    latency_ms=latency_ms,
                    input_tokens=in_tokens,
                    output_tokens=out_tokens,
                    raw_response=raw_resp,
                )

            except urllib.error.HTTPError as he:
                code = int(getattr(he, "code", 0) or 0)
                last_http_error = he
                last_error = GeminiServiceError(
                    mask_secrets(f"Gemini HTTP {code}: {he.reason}", (self.api_key,))
                )
                if code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    time.sleep(min(8.0, (2 ** attempt) * 0.6 + random.uniform(0.0, 0.25)))
                    continue
                break
            except (urllib.error.URLError, TimeoutError) as ne:
                last_error = GeminiServiceError(mask_secrets(f"Gemini network error: {ne}", (self.api_key,)))
                if attempt < self.max_retries:
                    time.sleep(min(8.0, (2 ** attempt) * 0.5))
                    continue
                break
            except GeminiServiceError as ge:
                last_error = ge
                break
            except Exception as exc:
                last_error = GeminiServiceError(mask_secrets(f"Gemini failure: {exc}", (self.api_key,)))
                break

        latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)
        err_msg = mask_secrets(str(last_error or "Unknown Gemini error"), (self.api_key,))
        self._log_usage(
            capability=capability,
            model=chosen_model,
            prompt_version=prompt_version,
            status="ERROR",
            latency_ms=latency_ms,
            error_type=type(last_error).__name__ if last_error else "Error",
        )
        raise GeminiServiceError(err_msg) from (last_http_error or last_error)


def get_gemini_service(
    config: Optional[Any] = None,
    db_path: Optional[str] = None,
    **kwargs: Any,
) -> GeminiService:
    """Factory returning a configured GeminiService instance."""
    return GeminiService(config=config, db_path=db_path, **kwargs)
