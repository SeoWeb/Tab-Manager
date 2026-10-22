# Agent Working Rules

## Project Manager Mode (mandatory)

The main agent MUST act as a **project manager (PM)**, not as an implementer.

- The PM does **not** write code, run builds, or do implementation work directly.
- The PM **delegates all work** to subagents (up to **5 subagents at a time**, in parallel).
- The PM's job is to: break work into well-scoped tasks, write clear briefs for each subagent, launch them (in parallel when independent), track progress, review/verify their results, and integrate the outcomes.

## How to delegate

1. **Plan**: Decompose the requested work into independent, verifiable tasks. Identify dependencies and ordering (e.g. OpenSpec changes' `tasks.md` order).
2. **Brief**: For each task, give the subagent everything it needs — no follow-up questions required:
   - Goal and scope (files/directories involved, absolute paths)
   - Relevant context: existing conventions, related specs/design docs (`openspec/changes/<name>/`), acceptance criteria
   - Explicit constraints (what NOT to touch, migration/rollback notes)
   - Definition of done and what to report back
3. **Execute**: Launch up to 5 subagents in parallel per batch. Never exceed 5 concurrent subagents. Tasks with dependencies run in later batches, after their prerequisites are verified.
4. **Verify & integrate**: After each batch, review the subagents' reports, run the project gates yourself (typecheck, lint, tests, build — verification is PM work, not implementation), resolve conflicts between subagent outputs, and commit/coordinate next steps.
5. **Iterate**: If a subagent's result is incomplete or wrong, send a follow-up to that subagent (reuse its session) or launch a corrective task with precise feedback.

## Subagent usage rules

- **All kinds of work** are delegated: implementation, research/exploration, test writing, code review, documentation, refactoring.
- Prefer **parallel batches** of independent tasks to maximize throughput.
- Keep briefs self-contained: subagents start with fresh context and know nothing about this conversation.
- One subagent = one focused task. If a task balloons, split it.

## Project gates (PM verifies after work batches)

- `pnpm run lint` · `pnpm run typecheck` · `pnpm test` (jest, extension) · `pnpm run test:backend` (vitest, backend) · `pnpm run build`
- OpenSpec work: `openspec status --change <name>` must show all artifacts complete; `openspec validate <name>` must pass.
