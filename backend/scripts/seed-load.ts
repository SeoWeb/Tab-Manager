/**
 * Seed the LOCAL wrangler D1 database (`tab-manager-dev`, --local) with a
 * load-test dataset for the sync backend (openspec: scale-sync-backend,
 * task 6.1).
 *
 * Generates deterministic SQL on stdout and never touches the network or the
 * filesystem itself; the `seed:load` npm script pipes the output into
 * `wrangler d1 execute tab-manager-dev --local --file=...`:
 *
 *   mkdir -p .wrangler/tmp && node scripts/seed-load.ts > .wrangler/tmp/seed-load.sql \
 *     && wrangler d1 execute tab-manager-dev --local --file=.wrangler/tmp/seed-load.sql -y
 *
 * Dataset (one user, one project):
 *   - 50 collections
 *   - 5,000 links with varied `updated_at` spread over 120 days
 *   - one `entity_versions` row per collection/link (versions 1..3)
 *   - 50,000 `sync_changes` rows spread over ~120 days, oldest first, with
 *     AUTOINCREMENT ids in created_at order (like production traffic)
 *
 * Runs are repeatable: the script first DELETEs the seed project's rows
 * (children before parents). Apply migrations first (`npm run migrate:local`).
 *
 * Rows are batched into 100-row multi-row INSERTs: each statement stays well
 * under D1's 100 KB statement-size limit (~20 KB here), and the whole seed is
 * ~600 statements, which the local D1 applies in one file execution.
 *
 * Human-readable progress goes to stderr, so stdout stays pure SQL.
 */

const USER_ID = 'u-load';
const PROJECT_ID = 'p-load';
const COLLECTION_COUNT = 50;
const LINK_COUNT = 5_000;
const CHANGE_COUNT = 50_000;
/** created_at / updated_at spread of the generated rows. */
const SPREAD_DAYS = 120;
/** Rows per multi-row INSERT (see header note). */
const ROWS_PER_STATEMENT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.now();

function iso(msAgo: number): string {
  return new Date(START - msAgo).toISOString();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** SQL string literal (the only escape that matters for our values). */
function q(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Build one INSERT statement per 100-row chunk. */
function insertMany(
  table: string,
  columns: string[],
  rows: string[][]
): string {
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows
      .slice(i, i + ROWS_PER_STATEMENT)
      .map((r) => `(${r.join(', ')})`)
      .join(',\n  ');
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n  ${chunk};`
    );
  }
  return statements.join('\n\n');
}

// --- Cleanup (children before parents; repeatable runs) ---------------------

const cleanup = `
-- Repeatability: drop the seed project's previous rows before inserting.
DELETE FROM sync_changes WHERE project_id = ${q(PROJECT_ID)};
DELETE FROM entity_versions WHERE project_id = ${q(PROJECT_ID)};
DELETE FROM links WHERE project_id = ${q(PROJECT_ID)};
DELETE FROM collections WHERE project_id = ${q(PROJECT_ID)};
DELETE FROM project_members WHERE project_id = ${q(PROJECT_ID)};
DELETE FROM projects WHERE id = ${q(PROJECT_ID)};
DELETE FROM users WHERE id = ${q(USER_ID)};
`;

// --- User, project, membership ----------------------------------------------

const createdAgo = SPREAD_DAYS * DAY_MS;
const userAndProject = `
INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES
  (${q(USER_ID)}, 'load-test@example.com', NULL, ${q(iso(createdAgo))}, ${q(iso(createdAgo))});

INSERT INTO projects (id, name, description, color, icon, owner_id, created_at, updated_at, deleted_at) VALUES
  (${q(PROJECT_ID)}, 'Load test', 'seed-load.ts dataset', NULL, NULL, ${q(USER_ID)}, ${q(iso(createdAgo))}, ${q(iso(0))}, NULL);

INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at) VALUES
  ('pm-load-1', ${q(PROJECT_ID)}, ${q(USER_ID)}, 'owner', ${q(iso(createdAgo))}, ${q(iso(createdAgo))});
`;

// --- Collections + links (+ their entity_versions rows) ---------------------

interface EntityRow {
  id: string;
  updatedAtMsAgo: number;
}

const collections: EntityRow[] = [];
for (let i = 0; i < COLLECTION_COUNT; i++) {
  collections.push({
    id: `col-${pad(i, 4)}`,
    // Oldest collection first, spread over the window.
    updatedAtMsAgo: createdAgo - Math.floor((createdAgo * i) / COLLECTION_COUNT),
  });
}

const links: EntityRow[] = [];
for (let i = 0; i < LINK_COUNT; i++) {
  links.push({
    id: `lnk-${pad(i, 5)}`,
    updatedAtMsAgo: Math.max(0, createdAgo - Math.floor((createdAgo * i) / LINK_COUNT)),
  });
}

const collectionRows: string[][] = collections.map((c, i) => [
  q(c.id),
  q(PROJECT_ID),
  q(`Collection ${i}`),
  'NULL', // description
  'NULL', // color
  '0', // minimized
  String(i), // order_index
  'NULL', // bookmark_folder_id
  q(iso(createdAgo)), // created_at
  q(iso(c.updatedAtMsAgo)), // updated_at
  'NULL', // deleted_at
]);

const linkRows: string[][] = links.map((l, i) => [
  q(l.id),
  q(PROJECT_ID),
  q(collections[i % COLLECTION_COUNT]!.id), // collection_id (FK satisfied)
  q(`https://example.com/load/${i}`),
  q(`Link ${i}`),
  'NULL', // fav_icon_url
  'NULL', // notes
  'NULL', // tags_json
  String(i), // order_index
  'NULL', // bookmark_id
  q(iso(createdAgo)), // created_at
  q(iso(l.updatedAtMsAgo)), // updated_at
  'NULL', // deleted_at
]);

const entityVersionRows: string[][] = [...collections, ...links].map((e, i) => [
  q(PROJECT_ID),
  q(e.id.startsWith('col-') ? 'collection' : 'link'),
  q(e.id),
  String(1 + (i % 3)), // version
  q(iso(e.updatedAtMsAgo)),
]);

// --- sync_changes (50,000 rows over ~120 days, oldest first) ----------------

const changeRows: string[][] = [];
for (let i = 0; i < CHANGE_COUNT; i++) {
  // Oldest first: id order matches created_at order, like real AUTOINCREMENT
  // traffic. ~3.5 min between consecutive rows; sub-minute deterministic
  // jitter (< 37 s) stays inside that gap so ordering is preserved.
  const msAgo =
    Math.floor((createdAgo * (CHANGE_COUNT - i)) / CHANGE_COUNT) +
    (i % 37) * 1_000;
  const isCollection = i % 1_000 === 0;
  const entityId = isCollection
    ? collections[Math.floor(i / 1_000) % COLLECTION_COUNT]!.id
    : links[i % LINK_COUNT]!.id;
  const opRoll = i % 100;
  const operation = opRoll < 90 ? 'update' : opRoll < 99 ? 'create' : 'delete';
  const patch =
    operation === 'delete'
      ? '{}'
      : isCollection
        ? `{"name":"Collection ${Math.floor(i / 1_000) % COLLECTION_COUNT} rev ${i}"}`
        : `{"title":"Link ${i % LINK_COUNT} rev ${i}"}`;
  changeRows.push([
    q(`ch-${pad(i + 1, 6)}`), // change_id (UNIQUE)
    q(PROJECT_ID),
    q(USER_ID), // actor_id
    q(isCollection ? 'collection' : 'link'),
    q(entityId),
    q(operation),
    q(patch),
    '1', // base_version
    'NULL', // client_mutation_id (seed rows are historical, not replays)
    q('seed-load'), // client_id
    q(iso(msAgo)),
  ]);
}

// --- Assemble ---------------------------------------------------------------

const collectionVersions = entityVersionRows.slice(0, COLLECTION_COUNT);
const linkVersions = entityVersionRows.slice(COLLECTION_COUNT);
const statementCount =
  3 + // user, project, membership
  Math.ceil(collectionRows.length / ROWS_PER_STATEMENT) +
  Math.ceil(collectionVersions.length / ROWS_PER_STATEMENT) +
  Math.ceil(linkRows.length / ROWS_PER_STATEMENT) +
  Math.ceil(linkVersions.length / ROWS_PER_STATEMENT) +
  Math.ceil(changeRows.length / ROWS_PER_STATEMENT);

const sql = `-- seed-load.ts: local D1 load-test dataset (${new Date(START).toISOString()})
-- user ${USER_ID} / project ${PROJECT_ID}: ${COLLECTION_COUNT} collections, ${LINK_COUNT} links,
-- ${CHANGE_COUNT} sync_changes over ~${SPREAD_DAYS} days. Repeatable (cleans up first).
${cleanup}
${userAndProject}

-- Collections (${COLLECTION_COUNT} rows)
${insertMany('collections', ['id', 'project_id', 'name', 'description', 'color', 'minimized', 'order_index', 'bookmark_folder_id', 'created_at', 'updated_at', 'deleted_at'], collectionRows)}

-- entity_versions for collections
${insertMany('entity_versions', ['project_id', 'entity_type', 'entity_id', 'version', 'updated_at'], collectionVersions)}

-- Links (${LINK_COUNT} rows)
${insertMany('links', ['id', 'project_id', 'collection_id', 'url', 'title', 'fav_icon_url', 'notes', 'tags_json', 'order_index', 'bookmark_id', 'created_at', 'updated_at', 'deleted_at'], linkRows)}

-- entity_versions for links
${insertMany('entity_versions', ['project_id', 'entity_type', 'entity_id', 'version', 'updated_at'], linkVersions)}

-- sync_changes (${CHANGE_COUNT} rows, oldest first)
${insertMany('sync_changes', ['change_id', 'project_id', 'actor_id', 'entity_type', 'entity_id', 'operation', 'patch_json', 'base_version', 'client_mutation_id', 'client_id', 'created_at'], changeRows)}
`;

// stdout is the SQL payload (piped into wrangler); progress goes to stderr.
console.log(sql);
console.error(
  `[seed-load] generated ${(sql.length / 1024 / 1024).toFixed(1)} MB of SQL: ` +
    `${COLLECTION_COUNT} collections, ${LINK_COUNT} links, ` +
    `${CHANGE_COUNT} sync_changes over ~${SPREAD_DAYS} days ` +
    `(${statementCount} INSERT statements, <=${ROWS_PER_STATEMENT} rows each)`
);
