"""Textual-powered live terminal UI (`--realtime`) rendered to `stderr`."""

from __future__ import annotations

import json
import sys
import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from rich.markup import escape

_event_listener: Callable[[str, dict[str, Any]], None] | None = None
_listener_lock = threading.Lock()


def is_realtime_active() -> bool:
    """Return True if a `--realtime` session is currently active."""
    return _event_listener is not None


def format_json_pretty(value: Any) -> str:
    """Attempt to parse or serialize value as 2-space pretty-printed JSON."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, indent=2, ensure_ascii=False, default=str)
    if isinstance(value, str):
        stripped = value.strip()
        if (stripped.startswith("{") and stripped.endswith("}")) or (
            stripped.startswith("[") and stripped.endswith("]")
        ):
            try:
                parsed = json.loads(stripped)
                return json.dumps(parsed, indent=2, ensure_ascii=False)
            except Exception:
                pass
        return value
    return str(value)


def emit_tui_event(event_type: str, data: dict[str, Any]) -> None:
    """Emit a realtime event to the active Textual TUI listener if present."""
    listener = _event_listener
    if listener is not None:
        try:
            listener(event_type, data)
        except Exception:
            pass


@contextmanager
def register_tui_listener(listener: Callable[[str, dict[str, Any]], None]) -> Iterator[None]:
    """Context manager to register a callback receiving realtime runtime events."""
    global _event_listener
    with _listener_lock:
        prev = _event_listener
        _event_listener = listener
    try:
        yield
    finally:
        with _listener_lock:
            _event_listener = prev


EVENT_STYLES: dict[str, tuple[str, str, str]] = {
    "prompt": ("💬", "bold cyan", "PROMPT"),
    "reasoning": ("🧠", "italic magenta", "REASONING"),
    "reasoning_delta": ("🧠", "italic magenta", "REASONING"),
    "response_delta": ("✨", "bold green", "RESPONSE"),
    "response": ("✨", "bold green", "RESPONSE"),
    "step": ("🔄", "bold blue", "STEP"),
    "tool_start": ("🔧", "bold yellow", "TOOL CALL"),
    "tool_end": ("📦", "yellow", "TOOL RESULT"),
    "retry": ("⚠️", "bold orange3", "SELF-REPAIR"),
    "log": ("📋", "dim white", "LOG"),
    "final": ("🏁", "bold bright_green", "FINAL RESULT"),
}


def format_event_line(event_type: str, data: dict[str, Any]) -> str:
    """Render an event into Rich-formatted text with icons, colors, and 2-space JSON pretty-printing."""
    icon, color, label = EVENT_STYLES.get(event_type, ("•", "white", event_type.upper()))
    if event_type == "prompt":
        kind = escape(str(data.get("kind", "ask")).upper())
        model = escape(str(data.get("model", "")))
        prompt_text = escape(format_json_pretty(data.get("prompt", "")))
        return f"[{color}]{icon} \\[{kind} | {model}] {label}:[/{color}]\n{prompt_text}"
    if event_type in {"reasoning", "reasoning_delta"}:
        raw_text = data.get("text") if "text" in data else data.get("delta", "")
        text = escape(str(raw_text))
        return f"[{color}]{icon} {label}:[/{color}] {text}"
    if event_type == "response_delta":
        raw_delta = data.get("delta") if "delta" in data else data.get("text", "")
        body = escape(format_json_pretty(raw_delta))
        return f"[{color}]{icon} {label}:[/{color}]\n{body}"
    if event_type == "response":
        body = escape(format_json_pretty(data.get("text", "")))
        return f"[{color}]{icon} {label}:[/{color}]\n{body}"
    if event_type == "step":
        step = data.get("step", 1)
        max_steps = data.get("max_steps", 25)
        return f"[{color}]{icon} {label} {step}/{max_steps}[/{color}]"
    if event_type == "tool_start":
        name = escape(str(data.get("name", "tool")))
        args_pretty = escape(format_json_pretty(data.get("args", {})))
        return f"[{color}]{icon} {label} \\[{name}]:[/{color}]\n{args_pretty}"
    if event_type == "tool_end":
        name = escape(str(data.get("name", "tool")))
        res_pretty = escape(format_json_pretty(data.get("result", "")))
        return f"[{color}]{icon} {label} \\[{name}]:[/{color}]\n{res_pretty}"
    if event_type == "retry":
        attempt = data.get("attempt", 1)
        err = escape(str(data.get("error", "")))
        return f"[{color}]{icon} {label} (attempt {attempt}):[/{color}] {err}"
    if event_type == "log":
        msg = escape(str(data.get("message", "")))
        return f"[{color}]{icon} {label}:[/{color}] {msg}"
    if event_type == "final":
        envelope = data.get("envelope", {})
        status = str(envelope.get("status", "ok"))
        final_color = "bold bright_green" if status == "ok" else "bold bright_red"
        pretty = escape(format_json_pretty(envelope))
        return f"[{final_color}]{icon} {label} ({escape(status.upper())}):[/{final_color}]\n{pretty}"
    return f"[{color}]{icon} {label}:[/{color}] {escape(format_json_pretty(data))}"


def run_with_realtime_tui(
    runner: Callable[[], dict[str, Any]],
    interactive: bool | None = None,
) -> dict[str, Any]:
    """Execute `runner()` inside a Textual live TUI rendered to `stderr`.

    When `stderr` is a TTY (and `interactive` is not False), stays open on completion
    until `q` or `Enter` is pressed. When non-TTY (or headless), auto-closes on completion.
    """
    from textual.app import App, ComposeResult
    from textual.binding import Binding
    from textual.widgets import Footer, Header, RichLog, Static

    is_tty = interactive if interactive is not None else bool(getattr(sys.stderr, "isatty", lambda: False)())
    result_holder: dict[str, Any] = {}
    error_holder: list[BaseException] = []

    class SPL2RealtimeApp(App[None]):
        TITLE = "SPL2 Realtime Execution"
        CSS = """
        Screen {
            background: $surface;
        }
        #status-bar {
            dock: top;
            height: 1;
            background: $primary-background;
            color: $text;
            padding: 0 1;
        }
        #event-log {
            height: 1fr;
            border: solid $primary;
            padding: 0 1;
        }
        """
        BINDINGS = [
            Binding("q", "quit", "Quit"),
            Binding("enter", "quit", "Close"),
        ]

        def __init__(self) -> None:
            super().__init__()
            self._committed_entries: list[str] = []
            self._committed_line_count: int = 0
            self._synced_committed_count: int = 0
            self._active_stream_type: str | None = None
            self._stream_buf: list[str] = []
            self._stream_has_deltas: bool = False

        def compose(self) -> ComposeResult:
            yield Header(show_clock=True)
            yield Static("⚡ Running SPL2 workflow...", id="status-bar")
            yield RichLog(id="event-log", highlight=True, markup=True, wrap=True)
            yield Footer()

        def on_mount(self) -> None:
            worker = threading.Thread(target=self._run_worker, daemon=True)
            worker.start()

        def _sync_log_if_needed(self, log_widget: RichLog) -> None:
            if not log_widget._size_known:
                return
            if self._synced_committed_count != len(self._committed_entries):
                log_widget.clear()
                for entry in self._committed_entries:
                    log_widget.write(entry)
                self._committed_line_count = len(log_widget.lines)
                self._synced_committed_count = len(self._committed_entries)

        def _render_active_stream(self, log_widget: RichLog, rendered: str) -> None:
            if not log_widget._size_known:
                log_widget.clear()
                for entry in self._committed_entries:
                    log_widget.write(entry)
                log_widget.write(rendered)
                return
            self._sync_log_if_needed(log_widget)
            del log_widget.lines[self._committed_line_count :]
            log_widget._line_cache.clear()
            log_widget.write(rendered)
            log_widget.refresh()

        def _commit_entry(self, log_widget: RichLog, rendered: str) -> None:
            if not log_widget._size_known:
                self._committed_entries.append(rendered)
                log_widget.clear()
                for entry in self._committed_entries:
                    log_widget.write(entry)
                return
            self._sync_log_if_needed(log_widget)
            del log_widget.lines[self._committed_line_count :]
            log_widget._line_cache.clear()
            log_widget.write(rendered)
            log_widget.refresh()
            self._committed_entries.append(rendered)
            self._committed_line_count = len(log_widget.lines)
            self._synced_committed_count = len(self._committed_entries)

        def _finalize_active_stream(
            self, log_widget: RichLog, override_text: Any = None
        ) -> None:
            if self._active_stream_type is None:
                return
            stream_type = self._active_stream_type
            text = (
                override_text
                if override_text is not None
                else "".join(self._stream_buf)
            )
            self._active_stream_type = None
            self._stream_buf.clear()
            self._stream_has_deltas = False
            rendered = format_event_line(stream_type, {"text": text})
            self._commit_entry(log_widget, rendered)

        def _append_event(self, event_type: str, data: dict[str, Any]) -> None:
            log_widget = self.query_one("#event-log", RichLog)
            status_widget = self.query_one("#status-bar", Static)

            if event_type == "reasoning_delta":
                raw_delta = data.get("delta") if "delta" in data else data.get("text", "")
                delta = str(raw_delta)
                if not delta:
                    return
                if self._active_stream_type not in (None, "reasoning"):
                    self._finalize_active_stream(log_widget)
                self._active_stream_type = "reasoning"
                self._stream_has_deltas = True
                self._stream_buf.append(delta)
                status_widget.update("🧠 Streaming reasoning...")
                combined = "".join(self._stream_buf)
                self._render_active_stream(
                    log_widget, format_event_line("reasoning", {"text": combined})
                )
                return

            if event_type == "reasoning":
                raw_text = data.get("text") if "text" in data else data.get("delta", "")
                text = str(raw_text)
                if self._active_stream_type not in (None, "reasoning"):
                    self._finalize_active_stream(log_widget)
                if self._active_stream_type == "reasoning":
                    if self._stream_has_deltas:
                        final_text = text if text else "".join(self._stream_buf)
                        self._finalize_active_stream(
                            log_widget, override_text=final_text
                        )
                    else:
                        if text:
                            if self._stream_buf:
                                self._stream_buf.append("\n")
                            self._stream_buf.append(text)
                        combined = "".join(self._stream_buf)
                        self._render_active_stream(
                            log_widget,
                            format_event_line("reasoning", {"text": combined}),
                        )
                    return
                self._active_stream_type = "reasoning"
                self._stream_has_deltas = False
                self._stream_buf = [text] if text else []
                status_widget.update("🧠 Streaming reasoning...")
                self._render_active_stream(
                    log_widget, format_event_line("reasoning", {"text": text})
                )
                return

            if event_type == "response_delta":
                raw_delta = data.get("delta") if "delta" in data else data.get("text", "")
                delta = str(raw_delta)
                if not delta:
                    return
                if self._active_stream_type not in (None, "response"):
                    self._finalize_active_stream(log_widget)
                self._active_stream_type = "response"
                self._stream_has_deltas = True
                self._stream_buf.append(delta)
                status_widget.update("✨ Streaming LLM tokens...")
                combined = "".join(self._stream_buf)
                self._render_active_stream(
                    log_widget, format_event_line("response", {"text": combined})
                )
                return

            if event_type == "response":
                raw_text = data.get("text") if "text" in data else data.get("delta", "")
                if self._active_stream_type not in (None, "response"):
                    self._finalize_active_stream(log_widget)
                if self._active_stream_type == "response":
                    final_text = (
                        raw_text
                        if raw_text not in (None, "")
                        else "".join(self._stream_buf)
                    )
                    self._finalize_active_stream(
                        log_widget, override_text=final_text
                    )
                    return
                self._commit_entry(
                    log_widget, format_event_line("response", {"text": raw_text})
                )
                return

            if self._active_stream_type is not None:
                self._finalize_active_stream(log_widget)

            if event_type == "prompt":
                status_widget.update(
                    f"💬 Calling {data.get('kind', 'LLM')} ({data.get('model', 'default')})..."
                )
            elif event_type == "tool_start":
                status_widget.update(f"🔧 Executing tool: {data.get('name', '')}...")
            elif event_type == "final":
                status = data.get("envelope", {}).get("status", "ok")
                hint = "Press q or Enter to exit." if is_tty else "Completed."
                status_widget.update(f"🏁 Execution finished ({status.upper()}). {hint}")

            self._commit_entry(log_widget, format_event_line(event_type, data))

        def _on_runtime_event(self, event_type: str, data: dict[str, Any]) -> None:
            try:
                self.call_from_thread(self._append_event, event_type, data)
            except Exception:
                pass

        def _run_worker(self) -> None:
            with register_tui_listener(self._on_runtime_event):
                try:
                    env = runner()
                    result_holder["envelope"] = env
                    self._on_runtime_event("final", {"envelope": env})
                except BaseException as exc:
                    error_holder.append(exc)
                finally:
                    if not is_tty:
                        try:
                            self.call_from_thread(self.exit)
                        except Exception:
                            pass

    # Route sys.stdout to sys.stderr while Textual runs so Textual renders to stderr
    # and stdout remains untouched for the final JSON envelope.
    saved_stdout = sys.stdout
    try:
        sys.stdout = sys.stderr
        app = SPL2RealtimeApp()
        app.run(headless=not is_tty)
    finally:
        sys.stdout = saved_stdout

    if error_holder:
        raise error_holder[0]
    return result_holder.get(
        "envelope",
        {"status": "ok", "reason": None, "lineno": 1, "data": None},
    )
