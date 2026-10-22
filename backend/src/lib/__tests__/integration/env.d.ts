/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'virtual:d1-migrations' {
  const migrations: import('cloudflare:test').D1Migration[];
  export default migrations;
}
