# Per-project Tasks / Calendar / Notes / Todos + Cloud Sync

## Context

Today the extension's Tasks, Calendar, Notes, and Todos views all read from **global** store arrays — they are not scoped to a project. The user wants these to be **per-project**, and when a project is shared with a team via the backend, the per-project tasks/notes/todos should **sync** to all members.

Exploration found that **most of the infrastructure already exists**, so this is a smaller change than it first appears:

- **Backend — already complete.** `backend/src/db/migrations/0001_init.sql` has `tasks`, `notes`, `todos` tables, all with `project_id NOT NULL`. `backend/src/lib/sync.ts` (`tableFor`, `prepareInsert`/`prepareUpdate` at lines 482-485 / 501-504) routes these entity types through the JSON-entity handlers using `mutation.projectId` as the `project_id` column. Team sharing, roles, and invites are fully built. **No backend change is required.**
- **Client read-path — already complete.** `src/lib/cloudflareSync/applyChanges.ts` already folds incoming `task`/`note`/`todo` change-log rows into the store (create/update/delete). The only gap: `buildNote`/`buildTodo` don't stamp `projectId` from the incoming change (fixed in Phase B2).
- **Client write-path — MISSING.** Only `projectActions`, `collectionActions`, `linkActions`, `dragDropActions` call `enqueueCloudChange`. Notes/todos/tasks never push, so today accepting an invite pulls others' items but your own edits don't sync.
- **Data model — partial.** `AdvancedTask` already has `projectId?` (and a `getTasksForProject()` selector exists at `taskActions.ts:828`). `Note` and `LegacyTask` (todo) have **no** `projectId` field.
- **Calendar is not separate data** — `TaskCalendarView.tsx` renders tasks by `dueDate`, so it becomes per-project automatically once tasks are scoped. No new entity.

**Decisions confirmed with the user:**

1. **Migrate to active project** — existing global items are assigned to the active project at upgrade time; afterward every new item always belongs to the active project (strict per-project, no global bucket).
2. **Calendar stays task-derived** (no standalone calendar-event entity).
3. **Full plan** — both per-project scoping (Phase A) and cloud-sync write-path wiring (Phase B).

---

## Phase A — Per-project scoping (client-only; works without a backend)

### A1. Types — add `projectId`

- `src/stores/types.ts` → `Note` interface: add `projectId: string`.
- `src/types/tasks.ts` → `LegacyTask` (todo) interface: add `projectId: string`.
- `AdvancedTask` already has `projectId?` — no change (make it `string` if tightening is desired, but optional is fine since creation always sets it).

### A2. Migration of existing global items

- In the Zustand persist migration (`src/stores/appStore.ts`, the `migrate`/`onRehydrateStorage` hook — bump the persisted version), stamp `projectId` on every existing note/todo/task that lacks one, using `activeProjectId ?? projects[0]?.id ?? null`. Items that resolve to `null` (no projects exist yet) remain visible only via the global Tasks route as a safety net; normal creation always sets a real id.

### A3. Creation always stamps the active project

- `src/stores/actions/noteActions.ts` → `addNote` (line ~7): set `projectId: get().activeProjectId ?? get().projects[0]?.id` on the new note.
- `src/stores/actions/uiActions.ts` → `addTodo` (line ~123): same stamping.
- `src/stores/actions/taskActions.ts` → `addTask` (line ~132): stamp `projectId: get().activeProjectId ?? get().projects[0]?.id` when not explicitly provided (tasks already carry the field).
- View call sites don't need signature changes — the store reads `activeProjectId` internally.

### A4. Filter the views by `activeProjectId`

- `NotesView.tsx` → filter `notes` to `n.projectId === activeProjectId`.
- `TodosView.tsx` → filter `todos` to `t.projectId === activeProjectId`.
- `TasksView.tsx` → add an optional `projectId?: string` prop. Filter the `tasks` selector (`state.tasks`, line ~46) to that project when the prop is present; leave unfiltered when absent.
  - `MainContentArea.tsx` (lines ~193-202) passes `projectId={activeProjectId}` to both `<TasksView />` renders (the Tasks and Calendar tabs). Notes and Todos are separate views (`NotesView`/`TodosView`) that read `activeProjectId` from the store directly, so they take no prop.
  - `AppClient.tsx` (line ~184-185, the full-width global `activeView === 'tasks'` route) renders `<TasksView />` **without** the prop → shows all tasks across projects (a cross-project dashboard). This is the natural home for the global view and doesn't conflict with "items always belong to the active project".
- `TaskCalendarView.tsx` and `ArchivedTasksView.tsx` already receive `tasks` as a prop from `TasksView`, so they inherit the filter automatically — no change.

### A5. Cascade on project delete

- `src/stores/actions/projectActions.ts` delete path (around the existing `enqueueCloudChange` delete at line ~169): also remove that project's notes/todos/tasks locally (`projectId === id`). (Backend cascades via `ON DELETE CASCADE`, so remote is already handled.)

---

## Phase B — Cloud-sync write path (so shared projects sync these too)

The guarded entry point `enqueueCloudChange` (`src/lib/cloudflareSync/orchestrator.ts:57`) already no-ops unless cloud is enabled **and** the owning project is `cloudEnabled` — so calling it from every action is safe for local-only users.

### B1. Enqueue mutations in the three action files

Add `void enqueueCloudChange({...})` to create/update/delete in each (mirroring how `collectionActions.ts`/`linkActions.ts` already do it):

- `noteActions.ts` — `addNote`/`updateNote`/`deleteNote`.
- `uiActions.ts` — `addTodo`/`toggleTodo`/`removeTodo`.
- `taskActions.ts` — `addTask`/`updateTask` (and the delete path).

**Patch shape** must match what `applyChanges.ts` expects on the way back and what the backend's JSON-entity handlers store (`title` + `payload_json`):

```
{ title, projectId, collectionId?, payload: { /* full/nested fields */ } }
```

- Note payload: `{ content, color, isPinned }`.
- Todo payload: `{ text, completed, category }`.
- Task payload: `{ description, priority, status, category, tags, notes, progress, ... }` (task's flat fields).
  `projectId`/`collectionId` go at the patch top level so both the server column write and `applyChanges` can read them.

### B2. Fix the read-path to stamp `projectId` on remote notes/todos

- `src/lib/cloudflareSync/applyChanges.ts`:
  - `buildNote` (~line 391): add `projectId: change.project_id` (read from the change row, not the patch).
  - `buildTodo` (~line 458): add `projectId: change.project_id`.
  - `buildTask` (~line 517): prefer `change.project_id` then `patch.projectId` (currently only reads patch).
  - `mergeNote`/`mergeTodo`/`mergeTask`: no change — `projectId` is immutable once set.
  - These functions currently take `(id, patch, payload, createdAt)`; thread `change.project_id` through (e.g. pass the whole `change` or add a `projectId` arg).

### B3. Backfill on convert-to-cloud

- `src/lib/cloudflareSync/orchestrator.ts` → `convertProjectToCloud` (lines ~463-482 currently backfill only collections/links): after re-keying, also enqueue `'create'` mutations for the project's existing notes/todos/tasks (filter each global array by the old local project id, push creates with the new server project id). This mirrors the existing collection/link backfill loop.

### B4. Backend — no change

Confirmed: `backend/src/lib/sync.ts` `prepareInsert`/`prepareUpdate` already handle `'task' | 'note' | 'todo'` via the JSON-entity handlers and bind `mutation.projectId` to the `project_id` column. The D1 schema already enforces `project_id NOT NULL` with `ON DELETE CASCADE`.

---

## Files to modify

**Types / store:** `src/stores/types.ts` (Note + todo sigs), `src/types/tasks.ts` (LegacyTask), `src/stores/appStore.ts` (persist migration).

**Actions:** `src/stores/actions/noteActions.ts`, `src/stores/actions/uiActions.ts` (todos), `src/stores/actions/taskActions.ts`, `src/stores/actions/projectActions.ts` (delete cascade).

**Views:** `src/components/views/NotesView.tsx`, `src/components/views/TodosView.tsx`, `src/components/views/TasksView.tsx` (add `projectId` prop), `src/components/main-content/MainContentArea.tsx` (pass prop).

**Sync:** `src/lib/cloudflareSync/applyChanges.ts` (projectId on remote notes/todos), `src/lib/cloudflareSync/orchestrator.ts` (convert-backfill).

**No changes:** `backend/**`, `TaskCalendarView.tsx`, `ArchivedTasksView.tsx`.

---

## Verification

1. **Typecheck/build:** `npm run build` (or `npm run typecheck`) — confirms the type additions and signature changes compile.
2. **Unit tests:** extend `src/lib/__tests__/bookmarkSyncService.test.ts`-adjacent cloud-sync tests (and any note/task action tests) to assert (a) `applyChanges` stamps `projectId` from `change.project_id` for note/todo/task, (b) note/todo/task create/update/delete produce the expected `enqueueCloudChange` patch shape, (c) the migrate function assigns existing items to the active project.
3. **Manual — isolation (Phase A):** load the extension, create a note + todo + task while project A is active; switch to project B; confirm none of A's items appear, and creating in B shows only B's items. Confirm the Calendar tab reflects only the active project's tasks.
4. **Manual — sync (Phase B):** enable cloud sync, convert project A to cloud (or create a cloud project); add a note/task/todo; run sync; confirm the mutation is pushed. On a second browser profile, accept the invite for the same project, sync, and confirm the items appear with the correct `projectId` and show only within that project. Edit from the second profile and confirm it round-trips back.
5. **Migration check:** with pre-existing global notes/todos/tasks in storage, load the new build once and confirm they are assigned to the active project and still visible (not orphaned).
