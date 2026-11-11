#!/usr/bin/env python3
"""Reverse proxy in front of supermemory-server that patches the Memory Graph UI.

Fixes:
1. Strip a leading ``Bearer `` from the pasted API key (UI already adds Bearer).
2. Persist the key in sessionStorage so reload keeps the dashboard working.
3. Fall back to POST /v3/documents/list when /v3/documents/documents fails,
   adapting the response shape the graph expects.

Does not inject auth for anonymous clients — the pasted key is still required.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

UPSTREAM = os.environ.get("SUPERMEMORY_UPSTREAM", "http://127.0.0.1:6768").rstrip("/")
LISTEN_HOST = os.environ.get("SUPERMEMORY_PROXY_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("PORT", "6767"))

PATCH_MARKER = "/* contos-sm-console-proxy */"


def patch_local_console(js: str) -> str:
    if PATCH_MARKER in js:
        return js

    # Normalize pasted keys: UI always prefixes Bearer.
    js = js.replace(
        "async function fetchJson(input,apiKey,init){let headers=new Headers(init?.headers);headers.set(\"Authorization\",`Bearer ${apiKey}`);",
        "async function fetchJson(input,apiKey,init){apiKey=String(apiKey||\"\").replace(/^Bearer\\s+/i,\"\").trim();"
        "let headers=new Headers(init?.headers);headers.set(\"Authorization\",`Bearer ${apiKey}`);",
        1,
    )

    # Prefer list endpoint; keep documents/documents as first try for pagination shape.
    old_fetch = (
        'let data=await fetchJson("/v3/documents/documents",apiKey,{method:"POST",'
        'headers:{"content-type":"application/json"},'
        "body:JSON.stringify({page:pageToLoad,limit:PAGE_SIZE,sort:\"createdAt\",order:\"desc\"})});"
    )
    new_fetch = (
        'let data;try{data=await fetchJson("/v3/documents/documents",apiKey,{method:"POST",'
        'headers:{"content-type":"application/json"},'
        "body:JSON.stringify({page:pageToLoad,limit:PAGE_SIZE,sort:\"createdAt\",order:\"desc\"})});}"
        "catch(primaryErr){let listed=await fetchJson(\"/v3/documents/list\",apiKey,{method:\"POST\","
        'headers:{"content-type":"application/json"},body:"{}"});'
        "let rows=Array.isArray(listed)?listed:(listed.documents||listed.memories||[]);"
        "data={documents:rows,pagination:{totalItems:rows.length,totalPages:1,currentPage:1}};"
        "if(!(primaryErr instanceof Error&&/→ 404/.test(primaryErr.message))){"
        "if(!(Array.isArray(rows)&&rows.length>=0))throw primaryErr;}}"
    )
    if old_fetch not in js:
        raise RuntimeError("local-console.js documents fetch pattern not found; refuse to patch")
    js = js.replace(old_fetch, new_fetch, 1)

    # Persist / restore API key across reload within the tab session.
    old_app = (
        "function App(){let[apiKey,setApiKey]=$useState(null),[enteredKey,setEnteredKey]=$useState(\"\"),"
        "[connectionId,setConnectionId]=$useState(0);"
    )
    new_app = (
        "function App(){let[apiKey,setApiKey]=$useState(()=>{try{return sessionStorage.getItem(\"sm_console_api_key\")}catch{return null}}),"
        "[enteredKey,setEnteredKey]=$useState(\"\"),[connectionId,setConnectionId]=$useState(0);"
        "let setApiKeyPersisted=(value)=>{setApiKey(value);try{value?sessionStorage.setItem(\"sm_console_api_key\",value):"
        "sessionStorage.removeItem(\"sm_console_api_key\")}catch{}};"
    )
    if old_app not in js:
        raise RuntimeError("local-console.js App() pattern not found; refuse to patch")
    js = js.replace(old_app, new_app, 1)
    js = js.replace(
        "if(value)setApiKey(value),setEnteredKey(\"\"),setConnectionId((id)=>id+1)",
        "if(value)setApiKeyPersisted(value.replace(/^Bearer\\s+/i,\"\").trim()),setEnteredKey(\"\"),setConnectionId((id)=>id+1)",
        1,
    )
    js = js.replace(
        "onClick:()=>setApiKey(null)",
        "onClick:()=>setApiKeyPersisted(null)",
        1,
    )

    return PATCH_MARKER + "\n" + js


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("proxy: " + (fmt % args) + "\n")

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length > 0 else None
        url = f"{UPSTREAM}{self.path}"
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "content-length", "connection", "transfer-encoding"}
        }
        request = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method=self.command,
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as upstream:
                raw = upstream.read()
                status = upstream.status
                upstream_headers = dict(upstream.headers.items())
        except urllib.error.HTTPError as error:
            raw = error.read()
            status = error.code
            upstream_headers = dict(error.headers.items()) if error.headers else {}
        except Exception as error:
            payload = json.dumps({"error": "proxy_upstream_failed", "detail": str(error)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        path_only = self.path.split("?", 1)[0]
        content_type = upstream_headers.get("Content-Type", "")
        if (
            self.command == "GET"
            and path_only == "/local-console.js"
            and "javascript" in content_type
        ):
            try:
                raw = patch_local_console(raw.decode("utf-8")).encode("utf-8")
                upstream_headers["Content-Type"] = "application/javascript; charset=utf-8"
            except Exception as error:
                sys.stderr.write(f"proxy: patch failed: {error}\n")

        hop_by_hop = {
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailers",
            "transfer-encoding",
            "upgrade",
            "content-length",
            "content-encoding",
        }
        self.send_response(status)
        for key, value in upstream_headers.items():
            if key.lower() in hop_by_hop:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self._proxy()

    def do_HEAD(self) -> None:
        self._proxy()


def main() -> None:
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    sys.stderr.write(f"proxy: listening on {LISTEN_HOST}:{LISTEN_PORT} → {UPSTREAM}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
