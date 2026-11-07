"""Model Context Protocol (MCP) configuration and client support (stdio & HTTP/SSE)."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from .context import _match_mcp, get_active_restrict
from .tools import _notify_tool_event

logger = logging.getLogger("spl2")


@dataclass
class MCPServerConfig:
    """Configuration for a single local (stdio) or remote (http/sse) MCP server."""

    name: str
    transport: str  # "stdio" | "http" | "sse"
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class MCPToolSpec:
    """Metadata and schema for an exposed MCP tool."""

    server: str
    name: str
    description: str
    input_schema: dict[str, Any]

    @property
    def qualified_name(self) -> str:
        return f"{self.server}/{self.name}"

    @property
    def openai_tool_name(self) -> str:
        safe_srv = "".join(c if c.isalnum() or c in "_-" else "_" for c in self.server)
        safe_tool = "".join(c if c.isalnum() or c in "_-" else "_" for c in self.name)
        return f"mcp__{safe_srv}__{safe_tool}"

    def to_openai_schema(self) -> dict[str, Any]:
        params = dict(self.input_schema) if self.input_schema else {"type": "object", "properties": {}}
        if "type" not in params:
            params["type"] = "object"
        if "properties" not in params:
            params["properties"] = {}
        return {
            "type": "function",
            "name": self.openai_tool_name,
            "description": f"[MCP {self.server}/{self.name}] {self.description}".strip(),
            "parameters": params,
        }


class _StdioMCPClient:
    """JSON-RPC 2.0 client for a local stdio MCP server."""

    def __init__(self, config: MCPServerConfig) -> None:
        self.config = config
        self._proc: subprocess.Popen[str] | None = None
        self._id_counter = 0
        self._lock = threading.Lock()
        self._initialized = False

    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.poll() is None and self._initialized:
            return
        if not self.config.command:
            raise ValueError(f"MCP server '{self.config.name}' is missing 'command'.")
        env = dict(os.environ)
        env.update(self.config.env)
        cmd = [self.config.command, *self.config.args]
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=self.config.cwd or None,
            env=env,
            bufsize=1,
        )
        self._initialized = False
        self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "spl2-runtime", "version": "2.0.0"},
            },
        )
        self._notify("notifications/initialized", {})
        self._initialized = True

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        assert self._proc is not None and self._proc.stdin is not None
        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()

    def _request(self, method: str, params: dict[str, Any]) -> Any:
        assert self._proc is not None and self._proc.stdin is not None and self._proc.stdout is not None
        self._id_counter += 1
        req_id = self._id_counter
        msg = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()

        while True:
            line = self._proc.stdout.readline()
            if not line:
                stderr_out = ""
                if self._proc.stderr is not None:
                    try:
                        stderr_out = self._proc.stderr.read()
                    except Exception:
                        pass
                raise RuntimeError(
                    f"MCP stdio server '{self.config.name}' closed unexpectedly while waiting for '{method}'. {stderr_out}".strip()
                )
            line = line.strip()
            if not line:
                continue
            try:
                resp = json.loads(line)
            except json.JSONDecodeError:
                continue
            if resp.get("id") == req_id:
                if "error" in resp and resp["error"]:
                    err = resp["error"]
                    raise RuntimeError(
                        f"MCP error from '{self.config.name}' ({method}): {err.get('message', err)}"
                    )
                return resp.get("result")

    def list_tools(self) -> list[MCPToolSpec]:
        with self._lock:
            self._ensure_started()
            result = self._request("tools/list", {}) or {}
            tools_raw = result.get("tools", [])
            return [
                MCPToolSpec(
                    server=self.config.name,
                    name=t["name"],
                    description=t.get("description", ""),
                    input_schema=t.get("inputSchema") or {"type": "object", "properties": {}},
                )
                for t in tools_raw
                if isinstance(t, dict) and "name" in t
            ]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        with self._lock:
            self._ensure_started()
            result = self._request("tools/call", {"name": name, "arguments": arguments}) or {}
            return _extract_mcp_tool_result(result)

    def close(self) -> None:
        with self._lock:
            if self._proc is not None:
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=2)
                except Exception:
                    try:
                        self._proc.kill()
                    except Exception:
                        pass
                self._proc = None
                self._initialized = False


class _HttpMCPClient:
    """JSON-RPC 2.0 client for a remote HTTP / SSE MCP server."""

    def __init__(self, config: MCPServerConfig) -> None:
        self.config = config
        self._id_counter = 0
        self._lock = threading.Lock()
        self._initialized = False

    def _post(self, payload: dict[str, Any]) -> Any:
        if not self.config.url:
            raise ValueError(f"MCP server '{self.config.name}' is missing 'url'.")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **self.config.headers,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.config.url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
            if not raw:
                return None
            # Handle SSE `data: {...}` framing if server responds with text/event-stream
            if raw.startswith("event:") or raw.startswith("data:"):
                for line in raw.splitlines():
                    if line.startswith("data:"):
                        candidate = line[len("data:") :].strip()
                        if candidate:
                            return json.loads(candidate)
            return json.loads(raw)

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        self._id_counter += 1
        resp = self._post(
            {
                "jsonrpc": "2.0",
                "id": self._id_counter,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "spl2-runtime", "version": "2.0.0"},
                },
            }
        )
        if isinstance(resp, dict) and resp.get("error"):
            raise RuntimeError(f"MCP initialize error from '{self.config.name}': {resp['error']}")
        self._initialized = True

    def list_tools(self) -> list[MCPToolSpec]:
        with self._lock:
            self._ensure_initialized()
            self._id_counter += 1
            resp = self._post({"jsonrpc": "2.0", "id": self._id_counter, "method": "tools/list", "params": {}}) or {}
            if "error" in resp and resp["error"]:
                raise RuntimeError(f"MCP error from '{self.config.name}': {resp['error']}")
            result = resp.get("result") or {}
            tools_raw = result.get("tools", [])
            return [
                MCPToolSpec(
                    server=self.config.name,
                    name=t["name"],
                    description=t.get("description", ""),
                    input_schema=t.get("inputSchema") or {"type": "object", "properties": {}},
                )
                for t in tools_raw
                if isinstance(t, dict) and "name" in t
            ]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        with self._lock:
            self._ensure_initialized()
            self._id_counter += 1
            resp = (
                self._post(
                    {
                        "jsonrpc": "2.0",
                        "id": self._id_counter,
                        "method": "tools/call",
                        "params": {"name": name, "arguments": arguments},
                    }
                )
                or {}
            )
            if "error" in resp and resp["error"]:
                raise RuntimeError(f"MCP tool error from '{self.config.name}/{name}': {resp['error']}")
            return _extract_mcp_tool_result(resp.get("result") or {})

    def close(self) -> None:
        self._initialized = False


def _extract_mcp_tool_result(result: dict[str, Any]) -> Any:
    """Extract text/structured content from an MCP `tools/call` response."""
    if result.get("isError"):
        content = result.get("content", [])
        err_text = "\n".join(c.get("text", str(c)) for c in content if isinstance(c, dict)) or str(result)
        raise RuntimeError(f"MCP tool execution returned error: {err_text}")
    if "structuredContent" in result and result["structuredContent"] is not None:
        return result["structuredContent"]
    content = result.get("content")
    if isinstance(content, list):
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(str(item.get("text", "")))
            else:
                texts.append(json.dumps(item))
        return "\n".join(texts)
    return result


class MCPManager:
    """Manages configured MCP servers, tool discovery, allowlist filtering, and invocation."""

    def __init__(self, servers: dict[str, MCPServerConfig] | None = None) -> None:
        self.servers: dict[str, MCPServerConfig] = servers or {}
        self._clients: dict[str, _StdioMCPClient | _HttpMCPClient] = {}

    @classmethod
    def from_config_file(cls, config_path: str | Path | None = None, cwd: str | Path | None = None) -> MCPManager:
        target: Path | None = None
        if config_path is not None:
            target = Path(config_path)
            if not target.exists():
                raise FileNotFoundError(f"MCP configuration file not found: {config_path}")
        else:
            default_path = Path(cwd or os.getcwd()) / ".mcp.json"
            if default_path.is_file():
                target = default_path

        if target is None:
            return cls({})

        raw = json.loads(target.read_text(encoding="utf-8"))
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> MCPManager:
        servers_dict = raw.get("mcpServers") or raw.get("servers") or raw
        configs: dict[str, MCPServerConfig] = {}
        for name, spec in servers_dict.items():
            if not isinstance(spec, dict):
                continue
            url = spec.get("url")
            command = spec.get("command")
            transport = spec.get("type") or spec.get("transport") or ("http" if url else "stdio")
            configs[name] = MCPServerConfig(
                name=name,
                transport=str(transport).lower(),
                command=command,
                args=[str(a) for a in spec.get("args", [])],
                env={str(k): str(v) for k, v in (spec.get("env") or {}).items()},
                cwd=spec.get("cwd"),
                url=url,
                headers={str(k): str(v) for k, v in (spec.get("headers") or {}).items()},
            )
        return cls(configs)

    def _get_client(self, server_name: str) -> _StdioMCPClient | _HttpMCPClient:
        if server_name not in self._clients:
            if server_name not in self.servers:
                raise KeyError(f"Unknown MCP server: '{server_name}'")
            cfg = self.servers[server_name]
            if cfg.url or cfg.transport in {"http", "sse"}:
                self._clients[server_name] = _HttpMCPClient(cfg)
            else:
                self._clients[server_name] = _StdioMCPClient(cfg)
        return self._clients[server_name]

    def get_allowed_tools(
        self, mcp_modifier: str | Sequence[str] | None = None
    ) -> list[MCPToolSpec]:
        """Discover tools from allowed MCP servers filtered by `agent(mcp=...)` and `restrict(mcp=...)`."""
        if not self.servers:
            return []

        mod_patterns: list[str] | None = None
        if mcp_modifier is not None:
            if isinstance(mcp_modifier, str):
                mod_patterns = [p.strip() for p in mcp_modifier.split(",") if p.strip()]
            else:
                mod_patterns = []
                for item in mcp_modifier:
                    for p in str(item).split(","):
                        if p.strip():
                            mod_patterns.append(p.strip())

        restrict_policy = get_active_restrict()
        discovered: list[MCPToolSpec] = []

        for srv_name in self.servers:
            # Check if server could match modifier patterns before spawning process
            if mod_patterns is not None:
                if not any(
                    pat in {"*", "*/*"} or pat.split("/", 1)[0] in {"*", srv_name} or _match_mcp(srv_name, "any", pat)
                    for pat in mod_patterns
                ):
                    continue
            if not restrict_policy.is_mcp_allowed(srv_name, "any") and all(
                layer.mcp is not None
                and not any(p.split("/", 1)[0] in {"*", srv_name} for p in layer.mcp)
                for layer in restrict_policy.layers
                if layer.mcp is not None
            ):
                continue

            client = self._get_client(srv_name)
            for tool in client.list_tools():
                if mod_patterns is not None and not any(
                    _match_mcp(tool.server, tool.name, pat) for pat in mod_patterns
                ):
                    continue
                if not restrict_policy.is_mcp_allowed(tool.server, tool.name):
                    continue
                discovered.append(tool)

        return discovered

    def call_tool(self, server: str, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Invoke an MCP tool after verifying `restrict(mcp=...)` permissions."""
        get_active_restrict().check_mcp(server, tool_name)
        _notify_tool_event(f"mcp:{server}/{tool_name}", arguments, phase="start")
        client = self._get_client(server)
        result = client.call_tool(tool_name, arguments)
        _notify_tool_event(f"mcp:{server}/{tool_name}", arguments, result, phase="end")
        return result

    def close_all(self) -> None:
        for client in list(self._clients.values()):
            try:
                client.close()
            except Exception:
                pass
        self._clients.clear()
