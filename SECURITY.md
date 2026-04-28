# Security

OpenHarness runs model-directed workflows against local workspaces, so safety and permission boundaries are core product concerns.

Please report sensitive security issues privately to the repository owner before publishing details.

## Current Safety Model

- Filesystem tools are scoped to the configured workspace.
- Shell execution is blocked unless explicitly approved by policy.
- Task activity is written to a JSONL audit log.
