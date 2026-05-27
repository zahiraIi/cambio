#!/usr/bin/env python3
"""Launch Cambio locally for testing.

Examples:
  python3 scripts/launch.py              # Docker (default) → :8080
  python3 scripts/launch.py --native     # Go server + web/ static UI → :8080
  python3 scripts/launch.py --no-open    # skip opening the browser
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def need(cmd: str) -> None:
    if shutil.which(cmd) is None:
        die(f"{cmd!r} not found in PATH")


def need_docker_compose() -> None:
    need("docker")
    result = subprocess.run(
        ["docker", "compose", "version"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        die(
            "docker compose (v2 plugin) is required — install Docker Desktop "
            "or the docker-compose-plugin package"
        )


def spawn(cmd: list[str], *, cwd: Path = ROOT, env: dict | None = None) -> subprocess.Popen:
    print(f"+ {' '.join(cmd)}")
    kwargs: dict = {"cwd": str(cwd)}
    if env is not None:
        kwargs["env"] = env
    if os.name != "nt":
        kwargs["start_new_session"] = True
    return subprocess.Popen(cmd, **kwargs)


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name != "nt":
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        else:
            proc.terminate()
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        else:
            proc.kill()


def wait_http(url: str, timeout: float = 45) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if 200 <= resp.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.25)
    die(f"timed out waiting for {url}")


DEBUG_LOG = ROOT / ".cursor" / "debug-cf1f7b.log"


def debug_log(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    # #region agent log
    import json

    entry = {
        "sessionId": "cf1f7b",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with DEBUG_LOG.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass
    # #endregion


def port_in_use(port: str) -> bool:
    """True only when a process is LISTENing on the port (not TIME_WAIT)."""
    pids = port_listener_pids(port)
    # #region agent log
    debug_log(
        "B",
        "launch.py:port_in_use",
        "listen check",
        {"port": port, "listenerPids": pids, "inUse": bool(pids)},
    )
    # #endregion
    return bool(pids)


def port_listener_pids(port: str) -> list[str]:
    try:
        out = subprocess.check_output(
            ["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return [p.strip() for p in out.splitlines() if p.strip()]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def ensure_port_free(port: str, *, mode: str) -> None:
    if not port_in_use(port):
        return
    pids = port_listener_pids(port)
    debug_log(
        "A",
        "launch.py:ensure_port_free",
        "port conflict",
        {"port": port, "mode": mode, "listenerPids": pids},
    )
    pid_hint = f"kill {' '.join(pids)}" if pids else f"lsof -i :{port}"
    if mode == "docker":
        die(
            f"port {port} is already in use — Docker cannot bind it.\n"
            f"  Likely cause: native server still running ({pid_hint}).\n"
            f"  Fix: stop that process, or use: python3 scripts/launch.py --native"
        )
    die(
        f"port {port} is already in use ({pid_hint}).\n"
        f"  Stop the other process first, or pick another port: --port 8081"
    )


def ensure_web_ui() -> None:
    if not (WEB / "index.html").is_file():
        die("web/index.html missing")
    if not (WEB / "src" / "main.js").is_file():
        die("web/src/main.js missing")


def lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Launch Cambio for local testing")
    p.add_argument(
        "--native",
        action="store_true",
        help="Go server + web/ static UI without Docker",
    )
    p.add_argument("--port", default="8080", help="Host port (default: 8080)")
    p.add_argument(
        "--build",
        action="store_true",
        help="Force Docker image rebuild (docker mode only)",
    )
    p.add_argument(
        "--no-build",
        action="store_true",
        help="Skip Docker image rebuild",
    )
    p.add_argument("--no-open", action="store_true", help="Do not open a browser tab")
    return p.parse_args()


def print_ready(ui_url: str, port: str) -> None:
    print(f"\nCambio ready: {ui_url}")
    ip = lan_ip()
    if ip:
        print(f"LAN multiplayer: http://{ip}:{port}/")
        print("Public URL: see README — cloudflared tunnel --url http://localhost:{0}".format(port))
    print("Press Ctrl+C to stop.\n")


def run_docker(args: argparse.Namespace) -> None:
    need_docker_compose()
    ensure_web_ui()
    ensure_port_free(args.port, mode="docker")

    env = os.environ.copy()
    env["PORT"] = args.port

    cmd = ["docker", "compose", "up"]
    if args.build or not args.no_build:
        cmd.append("--build")

    procs: list[subprocess.Popen] = []

    def shutdown() -> None:
        for proc in reversed(procs):
            stop(proc)

    def on_signal(signum: int, _frame) -> None:
        print()
        shutdown()
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    compose = spawn(cmd, env=env)
    procs.append(compose)

    api_url = f"http://127.0.0.1:{args.port}/api/games"
    print(f"Waiting for server at {api_url} (image build may take a minute)…")
    wait_http(api_url, timeout=300)

    ui_url = f"http://127.0.0.1:{args.port}/"
    print_ready(ui_url, args.port)

    if not args.no_open:
        webbrowser.open(ui_url)

    try:
        while True:
            code = compose.poll()
            if code is not None:
                print(f"docker compose exited with code {code}", file=sys.stderr)
                raise SystemExit(code or 1)
            time.sleep(0.4)
    except KeyboardInterrupt:
        print()
        shutdown()


def run_native(args: argparse.Namespace) -> None:
    need("go")
    ensure_web_ui()
    ensure_port_free(args.port, mode="native")

    procs: list[subprocess.Popen] = []

    def shutdown() -> None:
        for proc in reversed(procs):
            stop(proc)

    def on_signal(signum: int, _frame) -> None:
        print()
        shutdown()
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    go = spawn(["go", "run", "./cmd/server", "-port", args.port])
    procs.append(go)

    ui_url = f"http://127.0.0.1:{args.port}/"
    wait_http(ui_url)
    print_ready(ui_url, args.port)

    if not args.no_open:
        webbrowser.open(ui_url)

    try:
        while True:
            code = go.poll()
            if code is not None:
                print(f"process exited with code {code}", file=sys.stderr)
                shutdown()
                raise SystemExit(code or 1)
            time.sleep(0.4)
    except KeyboardInterrupt:
        print()
        shutdown()


def main() -> None:
    args = parse_args()
    if args.native:
        run_native(args)
    else:
        run_docker(args)


if __name__ == "__main__":
    main()
