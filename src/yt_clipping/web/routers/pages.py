"""
Documentation hub, web studio UI pages, and static utility assets router.
"""

from __future__ import annotations
import os
from datetime import datetime, timezone
import markdown

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

from ..state import (
    BASE_DIR,
    DOCS_DIR,
    DOCS_HTML_PATH,
    LANDING_HTML_PATH,
    DASHBOARD_HTML_PATH,
)

router = APIRouter(tags=["Pages"])


@router.get("/docs", response_class=HTMLResponse)
def serve_docs():
    """Serves the interactive documentation hub and architecture viewer."""
    if os.path.exists(DOCS_HTML_PATH):
        with open(DOCS_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><body><h1>Documentation Hub Loading...</h1></body></html>"


@router.get("/docs/{doc_path:path}")
def serve_docs_subpath(doc_path: str, request: Request):
    """Serves specific documentation files, supporting both web viewing and raw markdown downloads."""
    clean_name = os.path.basename(doc_path.strip())
    # Allow looking in docs/ or repo root for README.md
    target_path = os.path.join(DOCS_DIR, clean_name)
    if not os.path.exists(target_path) and clean_name.lower() == "readme.md":
        target_path = os.path.join(BASE_DIR, "README.md")

    # Path traversal protection
    real_target = os.path.abspath(target_path)
    if not (real_target.startswith(DOCS_DIR) or real_target == os.path.abspath(os.path.join(BASE_DIR, "README.md"))):
        raise HTTPException(status_code=403, detail="Access denied: path traversal attempt detected.")

    if not os.path.exists(real_target):
        raise HTTPException(status_code=404, detail=f"Documentation file '{clean_name}' not found.")

    accept_hdr = request.headers.get("Accept", "").lower()
    raw_param = request.query_params.get("raw", "").lower() in ("1", "true", "yes")

    # If raw requested or non-HTML client, return raw markdown
    if raw_param or "text/markdown" in accept_hdr or "text/plain" in accept_hdr:
        with open(real_target, "r", encoding="utf-8") as _f:
            return Response(content=_f.read(), media_type="text/markdown")

    # Otherwise serve docs.html with the doc loaded
    if os.path.exists(DOCS_HTML_PATH):
        with open(DOCS_HTML_PATH, "r", encoding="utf-8") as _f:
            content = _f.read()
            return HTMLResponse(content=content.replace("let currentDoc = 'ARCHITECTURE.md';", f"let currentDoc = '{clean_name}';"))

    with open(real_target, "r", encoding="utf-8") as _f:
        return Response(content=_f.read(), media_type="text/plain")


@router.get("/api/v1/docs/list")
def list_available_docs():
    """Returns a list of all technical documentation and architectural reports."""
    items = []
    if os.path.exists(DOCS_DIR):
        for entry in os.listdir(DOCS_DIR):
            if entry.endswith(".md"):
                p = os.path.join(DOCS_DIR, entry)
                stat = os.stat(p)
                items.append({
                    "filename": entry,
                    "title": entry.replace("_", " ").replace(".md", "").title(),
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                })
    # Also include root README.md
    readme_p = os.path.join(BASE_DIR, "README.md")
    if os.path.exists(readme_p):
        stat = os.stat(readme_p)
        items.insert(0, {
            "filename": "README.md",
            "title": "Project Overview (README)",
            "size_bytes": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return {"total": len(items), "docs": sorted(items, key=lambda x: x["filename"])}


@router.get("/api/v1/docs/content/{filename:path}")
def get_doc_content(filename: str):
    """Retrieves and renders a documentation markdown file into HTML."""
    clean_name = os.path.basename(filename.strip())
    target_path = os.path.join(DOCS_DIR, clean_name)
    if not os.path.exists(target_path) and clean_name.lower() == "readme.md":
        target_path = os.path.join(BASE_DIR, "README.md")

    real_target = os.path.abspath(target_path)
    if not (real_target.startswith(DOCS_DIR) or real_target == os.path.abspath(os.path.join(BASE_DIR, "README.md"))):
        raise HTTPException(status_code=403, detail="Access denied: path traversal attempt detected.")

    if not os.path.exists(real_target) or not os.path.isfile(real_target):
        raise HTTPException(status_code=404, detail=f"Documentation file '{clean_name}' not found.")

    with open(real_target, "r", encoding="utf-8") as _f:
        raw_md = _f.read()

    # Extract first H1 as title if available
    title = clean_name.replace("_", " ").replace(".md", "").title()
    for line in raw_md.splitlines():
        if line.startswith("# "):
            title = line.lstrip("# ").strip()
            break

    rendered_html = markdown.markdown(raw_md, extensions=['fenced_code', 'tables', 'nl2br'])
    return {
        "filename": clean_name,
        "title": title,
        "markdown": raw_md,
        "html": rendered_html,
    }


@router.get("/", response_class=HTMLResponse)
def serve_dashboard():
    """Serves the advertising showcase homepage and interactive simulator."""
    if os.path.exists(LANDING_HTML_PATH):
        with open(LANDING_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    if os.path.exists(DASHBOARD_HTML_PATH):
        with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><head><title>YT Clip Studio</title></head><body><h1>Live Studio Loading...</h1></body></html>"


@router.get("/studio", response_class=HTMLResponse)
def serve_studio():
    """Serves the live interactive clipping studio and editor workspace."""
    if os.path.exists(DASHBOARD_HTML_PATH):
        with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><head><title>YT Clip Studio</title></head><body><h1>Live Studio Loading...</h1></body></html>"


@router.get("/login", response_class=HTMLResponse)
def serve_login():
    """Serves the client and tenant portal authentication flow."""
    if os.path.exists(LANDING_HTML_PATH):
        with open(LANDING_HTML_PATH, "r", encoding="utf-8") as _f:
            content = _f.read()
            return content.replace("<body", "<body onload=\"openAuthModal('tenant')\"")
    return serve_dashboard()


@router.get("/robots.txt", response_class=Response)
def serve_robots():
    """Serves search engine crawler instructions."""
    content = "User-agent: *\nAllow: /\nSitemap: http://localhost:8000/sitemap.xml\n"
    return Response(content=content, media_type="text/plain")


@router.get("/sitemap.xml", response_class=Response)
def serve_sitemap():
    """Serves XML sitemap for SEO discovery."""
    content = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://localhost:8000/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>"""
    return Response(content=content, media_type="application/xml")


@router.get("/favicon.svg", response_class=Response)
@router.get("/favicon.ico", response_class=Response)
def serve_favicon():
    """Serves crisp SVG studio favicon."""
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#08090d"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#2563eb" stroke-width="1.5"/>
  <polygon points="12,8 24,16 12,24" fill="#3b82f6"/>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")


@router.get("/og-image.svg", response_class=Response)
def serve_og_image():
    """Serves OpenGraph preview poster image (1200x630)."""
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <rect width="1200" height="630" fill="#08090d"/>
  <rect x="40" y="40" width="1120" height="550" rx="16" stroke="#1c202d" stroke-width="2"/>
  <text x="100" y="240" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="64" font-weight="800">YouTube Clipping Studio</text>
  <text x="100" y="320" fill="#8492a6" font-family="system-ui, sans-serif" font-size="28">Autonomous Long-to-Shorts Intelligence &amp; 9:16 Video Synthesis</text>
  <rect x="100" y="380" width="220" height="52" rx="8" fill="#2563eb"/>
  <text x="140" y="415" fill="#ffffff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">Open Studio</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")
