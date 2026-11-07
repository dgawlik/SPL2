"""Dynamic context-scoped policies (enforce, forbid, restrict) using contextvars."""

from __future__ import annotations

import contextvars
import fnmatch
import os
import shlex
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import urlparse


class RestrictionError(PermissionError):
    """Raised when an operation violates an active `restrict(...)` policy."""


def _normalize_list_arg(val: str | Path | Sequence[str | Path] | None) -> tuple[str, ...] | None:
    """Normalize a restrict modifier value (comma-separated string, Path, or sequence) into a tuple of strings."""
    if val is None:
        return None
    if isinstance(val, Path):
        return (str(val),)
    if isinstance(val, str):
        items = [part.strip() for part in val.split(",") if part.strip()]
        return tuple(items)
    result: list[str] = []
    for item in val:
        if isinstance(item, Path):
            result.append(str(item))
        elif isinstance(item, str):
            for part in item.split(","):
                p = part.strip()
                if p:
                    result.append(p)
        else:
            result.append(str(item))
    return tuple(result)


def _is_subpath(target: Path, allowed_root: Path) -> bool:
    """Return True if target is equal to or inside allowed_root (canonical path containment)."""
    try:
        target.relative_to(allowed_root)
        return True
    except ValueError:
        return False


def _match_host(host: str, pattern: str) -> bool:
    """Return True if hostname matches an allowed net pattern (exact or wildcard `*.example.com`)."""
    host = host.lower().strip(".")
    pat = pattern.lower().strip()
    if "://" in pat:
        parsed = urlparse(pat)
        pat = (parsed.hostname or pat).lower()
    pat = pat.strip(".")
    if not pat:
        return False
    if pat == "*":
        return True
    if pat.startswith("*."):
        suffix = pat[2:]
        return host == suffix or host.endswith("." + suffix)
    return fnmatch.fnmatchcase(host, pat)


def _match_mcp(server: str, tool: str, pattern: str) -> bool:
    """Return True if MCP server/tool matches `"server"`, `"server/*"`, or `"server/tool"`."""
    pat = pattern.strip()
    if not pat:
        return False
    if pat in {"*", "*/*"}:
        return True
    if "/" not in pat:
        return fnmatch.fnmatchcase(server, pat)
    srv_pat, tool_pat = pat.split("/", 1)
    return fnmatch.fnmatchcase(server, srv_pat) and fnmatch.fnmatchcase(tool, tool_pat)


def _normalize_exec_name(cmd: str) -> str:
    """Normalize an executable name (strip path and Windows .exe/.cmd/.bat suffix)."""
    name = os.path.basename(cmd.strip().strip('"').strip("'")).lower()
    for ext in (".exe", ".cmd", ".bat", ".ps1"):
        if name.endswith(ext):
            name = name[: -len(ext)]
            break
    return name


@dataclass(frozen=True)
class RestrictLayer:
    """A single `restrict(...)` block's normalized allowlists."""

    fs: tuple[Path, ...] | None = None
    net: tuple[str, ...] | None = None
    exec: tuple[str, ...] | None = None
    mcp: tuple[str, ...] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "fs": [str(p) for p in self.fs] if self.fs is not None else None,
            "net": list(self.net) if self.net is not None else None,
            "exec": list(self.exec) if self.exec is not None else None,
            "mcp": list(self.mcp) if self.mcp is not None else None,
        }


@dataclass(frozen=True)
class RestrictPolicy:
    """Composite policy representing the intersection of all active `restrict(...)` blocks."""

    layers: tuple[RestrictLayer, ...] = field(default_factory=tuple)

    @property
    def is_restricted(self) -> bool:
        return len(self.layers) > 0

    @property
    def fs(self) -> tuple[Path, ...] | None:
        """Return effective intersected filesystem roots if any fs restriction is active."""
        fs_layers = [layer.fs for layer in self.layers if layer.fs is not None]
        if not fs_layers:
            return None
        current = list(fs_layers[0])
        for next_layer in fs_layers[1:]:
            narrowed: list[Path] = []
            for p1 in current:
                for p2 in next_layer:
                    if _is_subpath(p1, p2):
                        narrowed.append(p1)
                    elif _is_subpath(p2, p1):
                        narrowed.append(p2)
            # Deduplicate preserving order
            seen: set[Path] = set()
            current = [p for p in narrowed if not (p in seen or seen.add(p))]
        return tuple(current)

    @property
    def exec(self) -> tuple[str, ...] | None:
        """Return effective intersected executable allowlist if any exec restriction is active."""
        exec_layers = [layer.exec for layer in self.layers if layer.exec is not None]
        if not exec_layers:
            return None
        current = set(exec_layers[0])
        for next_layer in exec_layers[1:]:
            current &= set(next_layer)
        return tuple(sorted(current))

    @property
    def net(self) -> tuple[str, ...] | None:
        """Return effective intersected network allowlist if any net restriction is active."""
        net_layers = [layer.net for layer in self.layers if layer.net is not None]
        if not net_layers:
            return None
        current = list(net_layers[0])
        for next_layer in net_layers[1:]:
            narrowed: list[str] = []
            for p1 in current:
                for p2 in next_layer:
                    # Keep the narrower pattern if one matches the other
                    h1 = p1[2:] if p1.startswith("*.") else p1
                    h2 = p2[2:] if p2.startswith("*.") else p2
                    if _match_host(h1, p2) and (not p1.startswith("*.") or p2.startswith("*.")):
                        narrowed.append(p1)
                    elif _match_host(h2, p1) and (not p2.startswith("*.") or p1.startswith("*.")):
                        narrowed.append(p2)
            seen: set[str] = set()
            current = [p for p in narrowed if not (p in seen or seen.add(p))]
        return tuple(current)

    @property
    def mcp(self) -> tuple[str, ...] | None:
        """Return effective intersected MCP allowlist if any mcp restriction is active."""
        mcp_layers = [layer.mcp for layer in self.layers if layer.mcp is not None]
        if not mcp_layers:
            return None
        current = list(mcp_layers[0])
        for next_layer in mcp_layers[1:]:
            narrowed: list[str] = []
            for p1 in current:
                s1, t1 = p1.split("/", 1) if "/" in p1 else (p1, "*")
                for p2 in next_layer:
                    s2, t2 = p2.split("/", 1) if "/" in p2 else (p2, "*")
                    if _match_mcp(s1, t1, p2):
                        narrowed.append(p1)
                    elif _match_mcp(s2, t2, p1):
                        narrowed.append(p2)
            seen: set[str] = set()
            current = [p for p in narrowed if not (p in seen or seen.add(p))]
        return tuple(current)

    def intersect(
        self,
        *,
        fs: str | Path | Sequence[str | Path] | None = None,
        net: str | Sequence[str] | None = None,
        exec: str | Sequence[str] | None = None,
        mcp: str | Sequence[str] | None = None,
    ) -> RestrictPolicy:
        fs_norm = _normalize_list_arg(fs)
        net_norm = _normalize_list_arg(net)
        exec_norm = _normalize_list_arg(exec)
        mcp_norm = _normalize_list_arg(mcp)

        fs_paths = (
            tuple(Path(p).resolve() for p in fs_norm) if fs_norm is not None else None
        )
        exec_names = (
            tuple(_normalize_exec_name(c) for c in exec_norm)
            if exec_norm is not None
            else None
        )
        new_layer = RestrictLayer(
            fs=fs_paths,
            net=net_norm,
            exec=exec_names,
            mcp=mcp_norm,
        )
        return RestrictPolicy(layers=self.layers + (new_layer,))

    def check_fs(self, target_path: str | Path) -> Path:
        """Validate that target_path is allowed by every active `fs` restriction layer."""
        resolved = Path(target_path).resolve()
        for layer in self.layers:
            if layer.fs is not None:
                if not any(_is_subpath(resolved, allowed) for allowed in layer.fs):
                    allowed_str = ", ".join(str(p) for p in layer.fs)
                    raise RestrictionError(
                        f"Filesystem access to '{target_path}' (resolved: '{resolved}') is denied by restrict(fs=[{allowed_str}])."
                    )
        return resolved

    def check_net(self, url_or_host: str) -> str:
        """Validate that url_or_host is allowed by every active `net` restriction layer."""
        if "://" in url_or_host:
            parsed = urlparse(url_or_host)
            host = (parsed.hostname or "").lower()
        else:
            host = url_or_host.split("/")[0].split(":")[0].lower()

        for layer in self.layers:
            if layer.net is not None:
                if not host or not any(_match_host(host, pat) for pat in layer.net):
                    allowed_str = ", ".join(layer.net)
                    raise RestrictionError(
                        f"Network access to host '{host or url_or_host}' is denied by restrict(net=[{allowed_str}])."
                    )
        return host

    def check_exec(self, command: str) -> None:
        """Validate that all executables in shell command are allowed by every active `exec` restriction layer."""
        exec_layers = [layer.exec for layer in self.layers if layer.exec is not None]
        if not exec_layers:
            return

        # Extract candidate command segments separated by &&, ||, ;, |
        import re

        segments = [seg.strip() for seg in re.split(r"&&|\|\||[;|]", command) if seg.strip()]
        if not segments:
            raise RestrictionError("Empty shell command is not allowed under restrict(exec=...).")

        for seg in segments:
            try:
                parts = shlex.split(seg, posix=(os.name != "nt"))
            except ValueError:
                parts = seg.split()
            # Skip leading VAR=val assignments
            exe_token = None
            for token in parts:
                if "=" in token and not token.startswith(("-", "/", "\\")):
                    continue
                exe_token = token
                break
            if not exe_token:
                continue
            exe_name = _normalize_exec_name(exe_token)
            for allowed_execs in exec_layers:
                if exe_name not in allowed_execs:
                    allowed_str = ", ".join(allowed_execs)
                    raise RestrictionError(
                        f"Shell execution of '{exe_name}' (in command {command!r}) is denied by restrict(exec=[{allowed_str}])."
                    )

    def check_mcp(self, server: str, tool: str) -> None:
        """Validate that MCP server/tool is allowed by every active `mcp` restriction layer."""
        for layer in self.layers:
            if layer.mcp is not None:
                if not any(_match_mcp(server, tool, pat) for pat in layer.mcp):
                    allowed_str = ", ".join(layer.mcp)
                    raise RestrictionError(
                        f"MCP tool '{server}/{tool}' is denied by restrict(mcp=[{allowed_str}])."
                    )

    def is_mcp_allowed(self, server: str, tool: str) -> bool:
        for layer in self.layers:
            if layer.mcp is not None:
                if not any(_match_mcp(server, tool, pat) for pat in layer.mcp):
                    return False
        return True

    def to_trace_signature(self) -> list[dict[str, Any]]:
        return [layer.to_dict() for layer in self.layers]


_enforce_var: contextvars.ContextVar[tuple[str, ...]] = contextvars.ContextVar(
    "spl2_enforces", default=()
)
_forbid_var: contextvars.ContextVar[tuple[str, ...]] = contextvars.ContextVar(
    "spl2_forbids", default=()
)
_restrict_var: contextvars.ContextVar[RestrictPolicy] = contextvars.ContextVar(
    "spl2_restrict", default=RestrictPolicy()
)


def get_active_enforces() -> tuple[str, ...]:
    """Return active `enforce` constraints in outer-to-inner order."""
    return _enforce_var.get()


def get_active_forbids() -> tuple[str, ...]:
    """Return active `forbid` constraints in outer-to-inner order."""
    return _forbid_var.get()


def get_active_restrict() -> RestrictPolicy:
    """Return the active intersected `RestrictPolicy`."""
    return _restrict_var.get()


@contextmanager
def enforce_scope(constraint: Any, **_: Any) -> Iterator[None]:
    """Context manager for `enforce <expr>:` blocks."""
    text = str(constraint).strip()
    if not text:
        raise ValueError("enforce constraint cannot be empty.")
    current = _enforce_var.get()
    token = _enforce_var.set(current + (text,))
    try:
        yield
    finally:
        _enforce_var.reset(token)


@contextmanager
def forbid_scope(constraint: Any, **_: Any) -> Iterator[None]:
    """Context manager for `forbid <expr>:` blocks."""
    text = str(constraint).strip()
    if not text:
        raise ValueError("forbid constraint cannot be empty.")
    current = _forbid_var.get()
    token = _forbid_var.set(current + (text,))
    try:
        yield
    finally:
        _forbid_var.reset(token)


@contextmanager
def restrict_scope(
    *,
    fs: str | Path | Sequence[str | Path] | None = None,
    net: str | Sequence[str] | None = None,
    exec: str | Sequence[str] | None = None,
    mcp: str | Sequence[str] | None = None,
    **_: Any,
) -> Iterator[RestrictPolicy]:
    """Context manager for `restrict(fs=..., net=..., exec=..., mcp=...):` blocks."""
    if fs is None and net is None and exec is None and mcp is None:
        raise ValueError(
            "Empty restrict() call: specify at least one of fs, net, exec, or mcp."
        )
    current = _restrict_var.get()
    next_policy = current.intersect(fs=fs, net=net, exec=exec, mcp=mcp)
    token = _restrict_var.set(next_policy)
    try:
        yield next_policy
    finally:
        _restrict_var.reset(token)


def get_context_snapshot() -> dict[str, Any]:
    """Return a serializable snapshot of active enforce, forbid, and restrict scopes for trace hashing."""
    return {
        "enforce": list(get_active_enforces()),
        "forbid": list(get_active_forbids()),
        "restrict": get_active_restrict().to_trace_signature(),
    }
