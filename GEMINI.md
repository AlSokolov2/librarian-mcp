# Project Governance & Workflow

## Git & Pull Requests
- **No Self-Approval**: The AI Agent is strictly forbidden from approving or merging its own Pull Requests. 
- All changes to the `master` branch must be reviewed and approved by the project owner (@AlSokolov2).
- Branch protection is active: CI tests must pass before any merge.
- **Zero-Tolerance Protocol**: The AI Agent MUST run `npm run validate` and ensure it passes (including 100% code coverage) before initiating any merge or finalizing a feature.
- **Security First**: Any detected secret or high-level vulnerability blocks the workflow.

## Standards
- Follow Conventional Commits.
- Use **Git Flow** for all code changes (feature/develop/master).
- Maintain 100% test coverage for core logic in `@librarian/shared`.
- Documentation must be updated alongside code changes.

## Architecture
- **Monorepo**: Managed via npm workspaces.
- **Atomic Services**: Tools are split into Hub, Git, and Search microservices.
