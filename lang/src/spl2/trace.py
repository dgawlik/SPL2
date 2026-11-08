"""Durable record-and-replay trace caching (`--trace`) with concurrency-safe matching and crash recovery."""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger("spl2")


def _canonical_json(obj: Any) -> str:
    """Serialize obj deterministically for content hashing."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=True, default=str)


def compute_content_hash(kind: str, payload: dict[str, Any]) -> str:
    """Compute SHA-256 content hash for (operation_kind, payload)."""
    raw = _canonical_json({"kind": kind, "payload": payload})
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class TraceManager:
    """Thread- and async-safe JSONL trace recorder and replay engine."""

    def __init__(self, trace_path: str | Path) -> None:
        self.trace_path = Path(trace_path)
        self._lock = threading.RLock()
        self._entries: list[dict[str, Any]] = []
        self._by_key: dict[tuple[str, int], int] = {}
        self._agent_steps: dict[str, dict[int, dict[str, Any]]] = {}
        self._occurrence_counters: dict[str, int] = {}
        self._agent_step_counters: dict[str, int] = {}
        self._matched_indices: set[int] = set()
        self._diverged = False
        self._load_existing()

    def _load_existing(self) -> None:
        if not self.trace_path.is_file():
            return
        try:
            lines = self.trace_path.read_text(encoding="utf-8").splitlines()
        except Exception as exc:
            logger.warning("Failed to read trace file %s: %s", self.trace_path, exc)
            return

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entry = json.loads(stripped)
            except json.JSONDecodeError:
                # Ignore truncated final line from a hard crash
                continue
            if not isinstance(entry, dict):
                continue
            idx = len(self._entries)
            self._entries.append(entry)
            kind = entry.get("kind")
            h = entry.get("content_hash")
            occ = entry.get("occurrence_index", 0)
            if kind == "agent_step":
                parent_key = entry.get("parent_agent_key", "")
                step_idx = entry.get("step_index", 0)
                self._agent_steps.setdefault(parent_key, {})[step_idx] = entry
            elif isinstance(h, str) and isinstance(occ, int):
                self._by_key[(h, occ)] = idx

    def _truncate_stale_entries_locked(self) -> None:
        """Truncate any un-replayed stale entries after a cache miss (divergence)."""
        if self._diverged:
            return
        self._diverged = True
        kept_entries = [
            entry for idx, entry in enumerate(self._entries) if idx in self._matched_indices
        ]
        self._entries = kept_entries
        self._by_key.clear()
        self._agent_steps.clear()
        for idx, entry in enumerate(self._entries):
            h = entry.get("content_hash")
            occ = entry.get("occurrence_index", 0)
            if entry.get("kind") == "agent_step":
                parent_key = entry.get("parent_agent_key", "")
                step_idx = entry.get("step_index", 0)
                self._agent_steps.setdefault(parent_key, {})[step_idx] = entry
            elif isinstance(h, str) and isinstance(occ, int):
                self._by_key[(h, occ)] = idx
        self._matched_indices = set(range(len(self._entries)))
        self._rewrite_file_locked()

    def _rewrite_file_locked(self) -> None:
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        with self.trace_path.open("w", encoding="utf-8") as f:
            for entry in self._entries:
                f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")

    def _append_entry_locked(self, entry: dict[str, Any]) -> None:
        idx = len(self._entries)
        self._entries.append(entry)
        self._matched_indices.add(idx)
        h = entry.get("content_hash")
        occ = entry.get("occurrence_index", 0)
        if entry.get("kind") == "agent_step":
            parent_key = entry.get("parent_agent_key", "")
            step_idx = entry.get("step_index", 0)
            self._agent_steps.setdefault(parent_key, {})[step_idx] = entry
        elif isinstance(h, str) and isinstance(occ, int):
            self._by_key[(h, occ)] = idx

        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        with self.trace_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")

    def claim_occurrence(self, kind: str, payload: dict[str, Any]) -> tuple[str, int, bool, Any]:
        """Claim `(content_hash, occurrence_index)` and check for a replay hit.

        Returns `(content_hash, occurrence_index, hit, cached_result)`.
        """
        content_hash = compute_content_hash(kind, payload)
        with self._lock:
            occ = self._occurrence_counters.get(content_hash, 0)
            self._occurrence_counters[content_hash] = occ + 1
            key = (content_hash, occ)
            if not self._diverged and key in self._by_key:
                entry_idx = self._by_key[key]
                self._matched_indices.add(entry_idx)
                entry = self._entries[entry_idx]
                logger.debug(
                    "Trace replay HIT for %s (hash=%s, occ=%d)",
                    kind,
                    content_hash[:12],
                    occ,
                )
                return content_hash, occ, True, entry.get("result")

            # For `agent` and `natural`, check if there are partial `agent_step` entries from a crashed run
            parent_key = f"{content_hash}:{occ}"
            if kind in {"agent", "natural"} and not self._diverged and parent_key in self._agent_steps:
                # Mark existing agent_step entries as matched so they aren't truncated while recovering
                for idx, e in enumerate(self._entries):
                    if e.get("kind") == "agent_step" and e.get("parent_agent_key") == parent_key:
                        self._matched_indices.add(idx)
                logger.debug(
                    "Trace partial agent crash recovery found for %s (%d steps)",
                    parent_key[:16],
                    len(self._agent_steps[parent_key]),
                )
                return content_hash, occ, False, None

            # Unrecorded content_hash encountered -> invalidate subsequent stale entries
            if self._entries and not self._diverged:
                logger.debug(
                    "Trace MISS for %s (hash=%s, occ=%d) — truncating subsequent stale trace entries",
                    kind,
                    content_hash[:12],
                    occ,
                )
                self._truncate_stale_entries_locked()

            return content_hash, occ, False, None

    def store_claimed(
        self, kind: str, content_hash: str, occurrence_index: int, result: Any
    ) -> None:
        """Record the completed result for a previously claimed `(content_hash, occurrence_index)`."""
        with self._lock:
            entry = {
                "kind": kind,
                "content_hash": content_hash,
                "occurrence_index": occurrence_index,
                "result": result,
            }
            self._append_entry_locked(entry)

    def lookup_agent_step(
        self, parent_agent_key: str, step_index: int, step_payload: dict[str, Any]
    ) -> tuple[bool, dict[str, Any] | None]:
        """Check if an intermediate agent step is available for crash-recovery replay."""
        step_hash = compute_content_hash("agent_step", step_payload)
        with self._lock:
            steps = self._agent_steps.get(parent_agent_key, {})
            entry = steps.get(step_index)
            if entry is not None and entry.get("content_hash") == step_hash:
                logger.debug(
                    "Trace replay HIT for agent_step %s step=%d",
                    parent_agent_key[:16],
                    step_index,
                )
                return True, entry.get("result")
            # Step diverged or reached point of crash -> truncate remaining steps
            if not self._diverged:
                self._truncate_stale_entries_locked()
            return False, None

    def record_agent_step(
        self,
        parent_agent_key: str,
        step_index: int,
        step_payload: dict[str, Any],
        step_result: dict[str, Any],
    ) -> None:
        """Record an intermediate agent step (assistant turn + tool outputs) for crash recovery."""
        step_hash = compute_content_hash("agent_step", step_payload)
        with self._lock:
            entry = {
                "kind": "agent_step",
                "parent_agent_key": parent_agent_key,
                "step_index": step_index,
                "content_hash": step_hash,
                "occurrence_index": step_index,
                "result": step_result,
            }
            self._append_entry_locked(entry)

    def lookup(self, kind: str, payload: dict[str, Any]) -> tuple[bool, Any]:
        """Lookup and claim a deterministic tool call in trace."""
        h, occ, hit, res = self.claim_occurrence(kind, payload)
        if hit:
            return True, res
        # Save claimed slot for subsequent `record()` call on the same thread/task
        self._agent_step_counters[f"pending:{kind}:{h}"] = occ
        return False, None

    def record(self, kind: str, payload: dict[str, Any], result: Any) -> None:
        """Record a deterministic tool call result in trace."""
        h = compute_content_hash(kind, payload)
        with self._lock:
            pending_key = f"pending:{kind}:{h}"
            if pending_key in self._agent_step_counters:
                occ = self._agent_step_counters.pop(pending_key)
            else:
                occ = self._occurrence_counters.get(h, 0)
                self._occurrence_counters[h] = occ + 1
            self.store_claimed(kind, h, occ, result)


_active_trace_var: contextvars.ContextVar[TraceManager | None] = contextvars.ContextVar(
    "spl2_active_trace", default=None
)
_inside_agent_var: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "spl2_inside_agent", default=False
)


def get_active_trace() -> TraceManager | None:
    return _active_trace_var.get()


def is_inside_agent_loop() -> bool:
    return _inside_agent_var.get()


@contextmanager
def trace_context(trace_manager: TraceManager | None) -> Iterator[TraceManager | None]:
    token = _active_trace_var.set(trace_manager)
    try:
        yield trace_manager
    finally:
        _active_trace_var.reset(token)


@contextmanager
def agent_loop_context() -> Iterator[None]:
    token = _inside_agent_var.set(True)
    try:
        yield
    finally:
        _inside_agent_var.reset(token)
