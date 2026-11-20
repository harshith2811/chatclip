"""
HTTP Range Streaming utility for HTML5 video playback and seeking.
"""

import os
from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse


def stream_video_with_range(file_path: str, request: Request) -> Response:
    """Streams a video file supporting HTTP Range requests for seamless in-browser seeking."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Requested video file does not exist.")

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if not range_header:
        # Full file stream
        def iterfile():
            with open(file_path, mode="rb") as f:
                while chunk := f.read(65536):
                    yield chunk

        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": "video/mp4",
        }
        return StreamingResponse(iterfile(), status_code=200, headers=headers)

    # Parse Range: bytes=start-end
    try:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        if start >= file_size or end >= file_size or start > end:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable.")
    except Exception:
        raise HTTPException(status_code=416, detail="Invalid range request.")

    chunk_size = (end - start) + 1

    def iter_chunk():
        with open(file_path, mode="rb") as f:
            f.seek(start)
            bytes_left = chunk_size
            while bytes_left > 0:
                read_bytes = min(bytes_left, 65536)
                data = f.read(read_bytes)
                if not data:
                    break
                bytes_left -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": "video/mp4",
    }
    return StreamingResponse(iter_chunk(), status_code=206, headers=headers)
