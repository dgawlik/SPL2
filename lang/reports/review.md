# Review of repository

- **HIGH** Insufficient restriction on file and shell access (src/spl2/tools.py, src/spl2/context.py)
  - Fix: Strengthen test coverage against bypasses; add additional parsing to prevent indirect exec/expansion and ensure all file/shell access goes through centralized checks.
- **HIGH** Agent tool JSON parsing accepts unvalidated input (src/spl2/runtime.py (agent tool JSON parsing))
  - Fix: Schema-validate all tool arguments before execution, with special care for write_file, shell, and custom MCP tools. Return safe errors for malformed input.
- **HIGH** Remote MCP tool arguments not schema validated (src/spl2/mcp.py, MCPManager.call_tool)
  - Fix: Validate all MCP tool arguments against their declared input schemas before sending; reject unexpected arguments.
- **HIGH** Missing timeouts and resource limits for subprocesses and network calls (src/spl2/tools.py, src/spl2/mcp.py, src/spl2/runtime.py, etc.)
  - Fix: Apply timeouts for all subprocess/network calls and output size limits to prevent hangs or resource exhaustion.
- **HIGH** Unrestricted access to environment variables (get_env tool) (src/spl2/runtime.py (get_env tool))
  - Fix: Implement allowlist or redact sensitive environment variables by default.
- **HIGH** User input used directly in sensitive operations (src/spl2/tools.py, general)
  - Fix: Ensure restrict policies/validation wrap all user input and add tests for edge cases (symlinks, unicode, device files, etc.).
- **HIGH** Blocking IO and lack of limits in MCP stdio client (src/spl2/mcp.py (_StdioMCPClient))
  - Fix: Use non-blocking IO, timeouts, threads for MCP I/O; clean up processes and test for resource leaks/deadlocks.

7 finding(s), 7 high severity