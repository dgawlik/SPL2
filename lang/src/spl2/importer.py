"""Import hook (`MetaPathFinder` and `SourceLoader`) for `.spl2` modules."""

from __future__ import annotations

import importlib.abc
import importlib.machinery
import importlib.util
import os
import sys
from pathlib import Path
from types import CodeType
from typing import Sequence

from .compiler import compile_spl2


class SPL2SourceLoader(importlib.abc.SourceLoader):
    """Loads and compiles `.spl2` source files on import."""

    def __init__(self, fullname: str, path: str) -> None:
        self.fullname = fullname
        self.path = path

    def get_filename(self, fullname: str) -> str:
        return self.path

    def get_data(self, path: str | bytes) -> bytes:
        return Path(os.fsdecode(path)).read_bytes()

    def source_to_code(
        self, data: bytes | str, path: bytes | str = "<string>", *, _optimize: int = -1
    ) -> CodeType:
        if isinstance(data, bytes):
            source_str = data.decode("utf-8")
        else:
            source_str = str(data)
        filename = os.fsdecode(path)
        return compile_spl2(source_str, filename=filename)


class SPL2MetaPathFinder(importlib.abc.MetaPathFinder):
    """Finds `.spl2` modules and packages along `sys.path` or package `__path__`."""

    def find_spec(
        self,
        fullname: str,
        path: Sequence[str] | None,
        target: object | None = None,
    ) -> importlib.machinery.ModuleSpec | None:
        tail_name = fullname.rpartition(".")[2]
        search_paths = list(path) if path is not None else list(sys.path)

        for entry in search_paths:
            base = Path(entry or os.getcwd())
            if not base.is_dir():
                continue

            # Check for package `pkg/__init__.spl2`
            pkg_init = base / tail_name / "__init__.spl2"
            if pkg_init.is_file():
                loader = SPL2SourceLoader(fullname, str(pkg_init))
                return importlib.util.spec_from_loader(
                    fullname,
                    loader,
                    origin=str(pkg_init),
                    is_package=True,
                )

            # Check for module `mod.spl2`
            mod_file = base / f"{tail_name}.spl2"
            if mod_file.is_file():
                loader = SPL2SourceLoader(fullname, str(mod_file))
                return importlib.util.spec_from_loader(
                    fullname,
                    loader,
                    origin=str(mod_file),
                    is_package=False,
                )

        return None


_FINDER_INSTANCE: SPL2MetaPathFinder | None = None


def install_import_hook() -> SPL2MetaPathFinder:
    """Register the `.spl2` `MetaPathFinder` on `sys.meta_path`."""
    global _FINDER_INSTANCE
    if _FINDER_INSTANCE is None:
        _FINDER_INSTANCE = SPL2MetaPathFinder()
    if _FINDER_INSTANCE not in sys.meta_path:
        sys.meta_path.insert(0, _FINDER_INSTANCE)
    return _FINDER_INSTANCE


def uninstall_import_hook() -> None:
    """Remove the `.spl2` `MetaPathFinder` from `sys.meta_path`."""
    global _FINDER_INSTANCE
    if _FINDER_INSTANCE is not None and _FINDER_INSTANCE in sys.meta_path:
        sys.meta_path.remove(_FINDER_INSTANCE)
