"""CLI entry point for the `spl2` command."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Sequence

from .compiler import SPL2SyntaxError, lint_spl2, transpile_spl2
from .runtime import run_spl2_file
from .tui import run_with_realtime_tui


def _parse_cli_args(argv: Sequence[str]) -> tuple[argparse.Namespace, list[str]]:
    """Parse `spl2 [options] <script.spl2> [script_args...]`."""
    parser = argparse.ArgumentParser(
        prog="spl2",
        description="Semantic Prompt Language v2 (SPL2) CLI and runtime.",
        add_help=True,
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Run static lint and AST validation without executing the script.",
    )
    parser.add_argument(
        "--emit-py",
        action="store_true",
        dest="emit_py",
        help="Output the transpiled Python source code (preserving original line numbers).",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model override (highest precedence).",
    )
    parser.add_argument(
        "--mcp",
        type=str,
        default=None,
        help="Path to MCP server configuration JSON file.",
    )
    parser.add_argument(
        "--trace",
        nargs="?",
        const="__DEFAULT__",
        default=None,
        help="Enable durable record-and-replay trace caching (defaults to <script_name>.trace.jsonl).",
    )
    parser.add_argument(
        "--log",
        type=str,
        default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "debug", "info", "warning", "error"],
        help="Logging level output to stderr (DEBUG, INFO, WARNING, ERROR).",
    )
    parser.add_argument(
        "--realtime",
        action="store_true",
        help="Launch the live Textual TUI on stderr with streaming updates.",
    )
    parser.add_argument(
        "script",
        type=str,
        help="Path to the .spl2 or runnable .md script to execute or check.",
    )
    parser.add_argument(
        "script_args",
        nargs=argparse.REMAINDER,
        help="Arguments passed to the .spl2 or .md script in sys.argv.",
    )
    ns = parser.parse_args(list(argv))
    return ns, list(ns.script_args)


def _configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name.upper(), logging.WARNING)
    root_logger = logging.getLogger("spl2")
    root_logger.setLevel(level)
    if not root_logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            logging.Formatter("[SPL2 %(levelname)s] %(message)s")
        )
        root_logger.addHandler(handler)
    else:
        for h in root_logger.handlers:
            h.setLevel(level)


def main(argv: Sequence[str] | None = None) -> int:
    """Main entry point for `spl2` executable."""
    args_list = list(sys.argv[1:] if argv is None else argv)
    try:
        ns, script_args = _parse_cli_args(args_list)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 1

    _configure_logging(ns.log)
    script_path = Path(ns.script)

    if not script_path.is_file():
        msg = f"Script file not found: {ns.script}"
        if ns.check or ns.emit_py:
            print(msg, file=sys.stderr)
            return 1
        print(
            json.dumps(
                {"status": "failure", "reason": msg, "lineno": 1, "data": None}
            ),
            file=sys.stdout,
        )
        return 1

    source = script_path.read_text(encoding="utf-8")

    # 1. `--check`: static lint and AST validation without executing or requiring API key
    if ns.check:
        diagnostics = lint_spl2(source, filename=str(script_path))
        if diagnostics:
            for d in diagnostics:
                print(d.format(), file=sys.stderr)
            return 1
        return 0

    # 2. `--emit-py`: output transpiled Python source preserving line numbers
    if ns.emit_py:
        try:
            py_source = transpile_spl2(source, filename=str(script_path))
        except SPL2SyntaxError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        sys.stdout.write(py_source)
        return 0

    # 3. Resolve `--trace` file path if requested
    trace_path: Path | None = None
    if ns.trace is not None:
        if ns.trace == "__DEFAULT__":
            trace_path = script_path.with_name(f"{script_path.stem}.trace.jsonl")
        else:
            trace_path = Path(ns.trace)

    # 4. Execute script (optionally inside Textual `--realtime` TUI)
    exit_code_holder = [0]

    def _run() -> dict[str, object]:
        env, code = run_spl2_file(
            script_path,
            script_args=script_args,
            model=ns.model,
            mcp_config_path=ns.mcp,
            trace_path=trace_path,
        )
        exit_code_holder[0] = code
        return env

    if ns.realtime:
        envelope = run_with_realtime_tui(_run)
    else:
        envelope = _run()

    print(json.dumps(envelope, ensure_ascii=False), file=sys.stdout)
    sys.stdout.flush()
    return exit_code_holder[0]


if __name__ == "__main__":
    raise SystemExit(main())
