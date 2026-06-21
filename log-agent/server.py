"""
Log Agent HTTP Server — runs inside mylog_analytics-container on port 8893.

Endpoints:
  GET  /                          standalone web UI
  GET  /health                    liveness + stack status
  POST /api/stream/loki/start     start Loki process
  POST /api/stream/loki/stop      stop Loki process
  POST /api/stream/promtail/start start Promtail process
  POST /api/stream/promtail/stop  stop Promtail process
  POST /api/stream/grafana/start  start Grafana server
  POST /api/stream/grafana/stop   stop Grafana server
  GET  /api/loki/labels           proxy Loki labels API
  POST /api/loki/query            proxy LogQL instant query
  POST /api/loki/query_range      proxy LogQL range query
  GET  /api/sources               list active Promtail scrape targets
  POST /api/chat/clear            clear AI chat history
  POST /api/tasks                 AI agent task (docker-manager-agent)
  WS   /ws/chat                   streaming AI chat
"""
import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import anthropic as _anthropic
from loguru import logger
from pydantic import BaseModel

# ── Loguru setup ──────────────────────────────────────────────────────────────
import logging as _logging

class _Interceptor(_logging.Handler):
    def emit(self, record):
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = _logging.currentframe(), 2
        while frame and frame.f_code.co_filename == _logging.__file__:
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())

_logging.basicConfig(handlers=[_Interceptor()], level=0, force=True)
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level:<8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> — <level>{message}</level>",
    level="INFO",
    colorize=True,
)

# ── Mirror log file ───────────────────────────────────────────────────────────
AGENT_DIR   = Path(__file__).parent
_script_rel = "log-agent/server_py.log"
_log_mirror_root = os.environ.get("LOG_MIRROR_ROOT", "")
if _log_mirror_root:
    _mirror_log = Path(_log_mirror_root) / _script_rel
else:
    _mirror_log = AGENT_DIR / "memory" / "server.log"
_mirror_log.parent.mkdir(parents=True, exist_ok=True)
logger.add(
    str(_mirror_log),
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {name}:{line} — {message}",
    level="INFO",
    rotation="50 MB",
    retention=10,
    colorize=False,
)
CONFIG_DIR  = AGENT_DIR.parent / "dockerspace" / "config"
MEMORY_DIR  = AGENT_DIR / "memory"
MEMORY_DIR.mkdir(exist_ok=True)

load_dotenv(AGENT_DIR / "agent.conf")

LOKI_URL      = "http://localhost:3100"
GRAFANA_URL   = "http://localhost:3000"
PROMTAIL_PORT = 9080

LOKI_CONFIG      = CONFIG_DIR / "loki-config.yaml"
PROMTAIL_CONFIG  = CONFIG_DIR / "promtail-config.yaml"
GRAFANA_HOME     = Path("/opt") / next(
    (p.name for p in Path("/opt").glob("grafana-*") if p.is_dir()), "grafana-11.5.0"
)

LOKI_PID_FILE     = Path("/tmp/loki.pid")
PROMTAIL_PID_FILE = Path("/tmp/promtail.pid")
GRAFANA_PID_FILE  = Path("/tmp/grafana.pid")

app = FastAPI(title="Log Agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# Dev tool: never let the browser cache JS/HTML/CSS, otherwise an edit→Upload→Start
# deploy keeps showing stale assets (e.g. an old stack.js leaving the Stack tab on
# "Loading tools…"). Serve static + the index with no-store.
@app.middleware("http")
async def _no_cache_assets(request, call_next):
    resp = await call_next(request)
    p = request.url.path
    if p == "/" or p.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


app.mount("/static", StaticFiles(directory=str(AGENT_DIR / "static")), name="static")

# ── Process helpers ───────────────────────────────────────────────────────────

def _read_pid(path: Path) -> int | None:
    try:
        pid = int(path.read_text().strip())
        os.kill(pid, 0)
        return pid
    except Exception:
        path.unlink(missing_ok=True)
        return None

def _is_running(pid_file: Path) -> bool:
    return _read_pid(pid_file) is not None

def _port_listening(port: int | str, host: str = "127.0.0.1") -> bool:
    """True if something is accepting TCP connections on `port`.

    Status is read from the port, not a PID file: the tools are launched by the
    container startup (via their start.sh) which bypasses the agent, so no PID
    file exists even though the process is up. The port is the source of truth.
    """
    try:
        port = int(port)
    except (TypeError, ValueError):
        return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0

def _kill_pid(pid_file: Path) -> bool:
    pid = _read_pid(pid_file)
    if pid is None:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        pid_file.unlink(missing_ok=True)
        return True
    except ProcessLookupError:
        pid_file.unlink(missing_ok=True)
        return False

async def _stream_script(cmd: list[str], pid_file: Path | None = None, env: dict | None = None):
    """SSE-stream a subprocess; yields `data: <line>\n\n`.

    Launch errors (e.g. the binary is missing because the container was recreated
    and /usr/local/bin was not persisted) are streamed as a readable error line
    instead of raising — otherwise the request 500s and nothing rolls in the UI.
    """
    run_env = {**os.environ, **(env or {})}

    async def generate():
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=run_env,
            )
        except FileNotFoundError:
            yield (f"data: [ERROR] '{cmd[0]}' not found on PATH inside the container. "
                   f"The binary is missing (likely the container was recreated and "
                   f"/usr/local/bin was not persisted). Run Build to reinstall it.\n\n")
            yield "data: __done__\n\n"
            return
        except Exception as e:
            yield f"data: [ERROR] failed to launch {cmd[0]}: {e}\n\n"
            yield "data: __done__\n\n"
            return

        if pid_file:
            pid_file.write_text(str(proc.pid))

        # Stream lines, but stop once the script process itself exits. A start
        # script launches a detached daemon (loki/grafana/...) that may keep the
        # stdout pipe's write-end open, so readline() would never see EOF and the
        # SSE stream would hang. Polling proc.returncode avoids that.
        while True:
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=0.5)
            except asyncio.TimeoutError:
                if proc.returncode is not None:
                    break          # script finished; don't wait on a daemon-held pipe
                continue
            if not line:
                break              # genuine EOF
            yield f"data: {line.decode(errors='replace').rstrip()}\n\n"

        # Drain anything still buffered, without blocking.
        try:
            while True:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=0.2)
                if not line:
                    break
                yield f"data: {line.decode(errors='replace').rstrip()}\n\n"
        except asyncio.TimeoutError:
            pass

        rc = proc.returncode if proc.returncode is not None else await proc.wait()
        yield f"data: [exit {rc}]\n\n"
        yield "data: __done__\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

async def _stream_stop(name: str, pid_file: Path):
    async def generate():
        pid = _read_pid(pid_file)
        if pid is None:
            yield f"data: {name} is not running.\n\n"
        else:
            try:
                os.kill(pid, signal.SIGTERM)
                pid_file.unlink(missing_ok=True)
                yield f"data: {name} stopped (PID {pid}).\n\n"
            except ProcessLookupError:
                pid_file.unlink(missing_ok=True)
                yield f"data: {name} process not found — already stopped.\n\n"
        yield "data: __done__\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(str(AGENT_DIR / "static" / "index.html"))

@app.get("/health")
async def health():
    loki_ok     = _port_listening(3100)
    promtail_ok = _port_listening(PROMTAIL_PORT)
    grafana_ok  = _port_listening(3000)

    # Quick connectivity check to Loki
    loki_reachable = False
    if loki_ok:
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                r = await client.get(f"{LOKI_URL}/ready")
                loki_reachable = r.status_code == 200
        except Exception:
            pass

    return {
        "loki_running":      loki_ok,
        "loki_reachable":    loki_reachable,
        "promtail_running":  promtail_ok,
        "grafana_running":   grafana_ok,
        "agent_running":     True,
        "timestamp":         datetime.now().isoformat(timespec="seconds"),
    }

# ── Tool framework ──────────────────────────────────────────────────────────────
# The agent is a thin sysadmin invoker. Each managed tool is a folder under tools/
# with a tool.conf plus the lifecycle scripts (build/start/stop/health/clean .sh).
# Adding a new tool = drop a new folder; no Python change needed.
TOOLS_DIR     = AGENT_DIR / "tools"
_TOOL_ACTIONS = ("build", "start", "stop", "health", "clean")


def _parse_tool_conf(conf: Path) -> dict:
    data = {}
    for line in conf.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        data[k.strip().lower()] = v.strip()
    return data


def _discover_tools() -> list[dict]:
    tools = []
    if not TOOLS_DIR.exists():
        return tools
    for d in sorted(TOOLS_DIR.iterdir()):
        conf = d / "tool.conf"
        if not d.is_dir() or not conf.exists():
            continue
        meta = _parse_tool_conf(conf)
        name = meta.get("name", d.name)
        port = meta.get("port", "")
        tools.append({
            "name":    name,
            "label":   meta.get("label", name),
            "port":    port,
            "order":   int(meta.get("order") or 99),
            "actions": [a for a in _TOOL_ACTIONS if (d / f"{a}.sh").exists()],
            "running": _port_listening(port),
        })
    tools.sort(key=lambda t: t["order"])
    return tools


@app.get("/api/tools")
async def list_tools():
    return {"tools": _discover_tools()}


@app.post("/api/tools/{name}/{action}")
async def run_tool_action(name: str, action: str):
    if action not in _TOOL_ACTIONS:
        return JSONResponse({"error": f"unknown action '{action}'"}, status_code=400)
    tool_dir = (TOOLS_DIR / name).resolve()
    # guard against path traversal — must be a direct child of tools/
    if tool_dir.parent != TOOLS_DIR.resolve() or not tool_dir.is_dir():
        return JSONResponse({"error": f"unknown tool '{name}'"}, status_code=404)
    script = tool_dir / f"{action}.sh"
    if not script.exists():
        async def missing():
            yield f"data: [ERROR] tool '{name}' has no {action}.sh\n\n"
            yield "data: __done__\n\n"
        return StreamingResponse(missing(), media_type="text/event-stream")
    # The scripts manage their own PID files, so don't pass pid_file here.
    return await _stream_script(["bash", str(script)])

# ── Loki proxy (LogQL) ────────────────────────────────────────────────────────

@app.get("/api/loki/labels")
async def loki_labels():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{LOKI_URL}/loki/api/v1/labels")
            return r.json()
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}

class QueryRequest(BaseModel):
    query: str
    limit: int = 100
    start: str = ""
    end: str = ""
    direction: str = "backward"

@app.post("/api/loki/query_range")
async def loki_query_range(req: QueryRequest):
    params = {"query": req.query, "limit": req.limit, "direction": req.direction}
    if req.start: params["start"] = req.start
    if req.end:   params["end"]   = req.end
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{LOKI_URL}/loki/api/v1/query_range", params=params)
            return r.json()
    except Exception as e:
        return {"status": "error", "message": str(e), "data": {"resultType": "streams", "result": []}}

@app.get("/api/sources")
async def sources():
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"http://localhost:{PROMTAIL_PORT}/targets")
            return {"status": "ok", "targets": r.text}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ── AI Chat ───────────────────────────────────────────────────────────────────

_chat_history: list[dict] = []
_SYSTEM_PROMPT = """You are a log analytics assistant embedded in a Dockerized workspace.
You help analyze logs from Loki, troubleshoot container issues, write LogQL queries,
and provide insights about system health. The stack includes:
- Loki (log aggregation, port 3100)
- Promtail (log shipper, scrapes Docker containers)
- Grafana (visualization, port 3000)
- This log-agent dashboard (port 8893)

Be concise and practical. When writing LogQL queries, wrap them in code blocks."""

@app.post("/api/chat/clear")
async def chat_clear():
    _chat_history.clear()
    return {"ok": True}

@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        await ws.send_json({"type": "error", "content": "ANTHROPIC_API_KEY not set in agent.conf"})
        return

    # Send history
    for msg in _chat_history:
        await ws.send_json({"type": "history_msg", "role": msg["role"],
                            "content": msg["content"][0]["text"] if isinstance(msg["content"], list) else msg["content"],
                            "ts": ""})
    try:
        while True:
            data = await ws.receive_json()
            user_text = data.get("content", "").strip()
            if not user_text:
                continue
            _chat_history.append({"role": "user", "content": user_text})
            client = _anthropic.Anthropic(api_key=api_key)
            try:
                with client.messages.stream(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2048,
                    system=_SYSTEM_PROMPT,
                    messages=_chat_history,
                ) as stream:
                    full = ""
                    for text in stream.text_stream:
                        full += text
                        await ws.send_json({"type": "text", "content": text})
                _chat_history.append({"role": "assistant", "content": full})
            except Exception as e:
                await ws.send_json({"type": "error", "content": str(e)})
            await ws.send_json({"type": "done"})
    except WebSocketDisconnect:
        pass

# ── Agent tasks (docker-manager-agent integration) ────────────────────────────

class TaskRequest(BaseModel):
    task: str

@app.post("/api/tasks")
async def run_task(req: TaskRequest):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"result": "ANTHROPIC_API_KEY not configured"}
    client = _anthropic.Anthropic(api_key=api_key)
    h = await health()
    ctx = f"Stack health: {json.dumps(h)}"
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        system=_SYSTEM_PROMPT + f"\n\nCurrent context: {ctx}",
        messages=[{"role": "user", "content": req.task}],
    )
    return {"result": resp.content[0].text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8893, reload=False)
