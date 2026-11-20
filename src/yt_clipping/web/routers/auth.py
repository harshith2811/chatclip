"""
Google OAuth 2.0 authentication and YouTube channel connection management router.
"""

from __future__ import annotations
from typing import Dict, Optional, Any
import json
import logging

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from ..state import youtube_auth

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Auth"])


@router.get("/api/v1/auth/google/url")
def api_get_google_auth_url(state: Optional[str] = None) -> Dict[str, str]:
    """Returns the dedicated OAuth 2.0 authorization URL for YouTube channel access."""
    url = youtube_auth.get_authorization_url(state=state)
    return {"auth_url": url}


@router.get("/api/v1/auth/google/callback")
def api_google_auth_callback(code: str, state: Optional[str] = None):
    """Exchanges OAuth authorization code for credentials and saves them to isolated store."""
    try:
        status_info = youtube_auth.exchange_code_for_tokens(code)
        # Return an HTML confirmation that automatically closes popup or redirects
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="background: #1e293b; padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; border: 1px solid #334155;">
            <h2 style="color: #10b981; margin-top: 0;">Channel Connected!</h2>
            <p>Dedicated YouTube Channel <strong>{status_info.get('channel_title')}</strong> ({status_info.get('channel_handle')}) is now authorized.</p>
            <script>
              if (window.opener) {{
                window.opener.postMessage({{ type: 'YOUTUBE_AUTH_SUCCESS', channel: {json.dumps(status_info)} }}, '*');
                setTimeout(() => window.close(), 1200);
              }} else {{
                setTimeout(() => window.location.href = '/?tab=publishing', 1500);
              }}
            </script>
          </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html, status_code=200)
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        return HTMLResponse(
            content=f"<html><body style='background:#0f172a;color:#ef4444;padding:2rem;'><h3>OAuth Failed</h3><p>{str(e)}</p></body></html>",
            status_code=400,
        )


@router.get("/api/v1/auth/google/status")
def api_get_google_auth_status() -> Dict[str, Any]:
    """Returns safe, sanitized channel connection state. Zero secrets exposed."""
    return youtube_auth.get_public_status()


@router.post("/api/v1/auth/google/disconnect")
def api_google_disconnect() -> Dict[str, Any]:
    """Revokes channel token and deletes stored credentials."""
    success = youtube_auth.disconnect()
    return {"status": "disconnected" if success else "failed", "connected": False}
