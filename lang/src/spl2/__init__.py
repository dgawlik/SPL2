"""Semantic Prompt Language v2 (SPL2) runtime and compiler."""

from __future__ import annotations

__version__ = "2.0.0"

from .compiler import (
    LintDiagnostic,
    SPL2SyntaxError,
    compile_spl2,
    lint_spl2,
    preprocess_spl2,
    transpile_spl2,
)
from .context import (
    RestrictionError,
    RestrictPolicy,
    enforce_scope,
    forbid_scope,
    get_active_enforces,
    get_active_forbids,
    get_active_restrict,
    restrict_scope,
)
from .importer import install_import_hook, uninstall_import_hook
from .runtime import (
    SPL2FailureException,
    SPL2RuntimeError,
    SPL2SuccessException,
    agent_async,
    agent_sync,
    ask_async,
    ask_sync,
    decide_async,
    decide_sync,
    run_spl2_file,
    run_spl2_source,
     trigger_failure,
    trigger_success,
)

__all__ = [
    "__version__",
    "LintDiagnostic",
    "SPL2SyntaxError",
    "compile_spl2",
    "lint_spl2",
    "preprocess_spl2",
    "transpile_spl2",
    "RestrictionError",
    "RestrictPolicy",
    "enforce_scope",
    "forbid_scope",
    "restrict_scope",
    "get_active_enforces",
    "get_active_forbids",
    "get_active_restrict",
    "install_import_hook",
    "uninstall_import_hook",
    "SPL2FailureException",
    "SPL2RuntimeError",
    "SPL2SuccessException",
    "ask_sync",
    "ask_async",
    "agent_sync",
    "agent_async",
    "decide_sync",
    "decide_async",
    "trigger_success",
    "trigger_failure",
    "run_spl2_file",
    "run_spl2_source",
]
