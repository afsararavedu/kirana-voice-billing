import type { TestProject } from 'vitest/node';
import { migrateDeploy, startLocalPg, type LocalPg } from '../scripts/embedded-pg.js';

let pg: LocalPg | undefined;

export async function setup(project: TestProject) {
  pg = await startLocalPg({
    dataDir: '.pgdata-test',
    port: 54329,
    database: 'kirana_test',
    persistent: false,
  });
  // Doubles as migration validation: committed migrations must apply cleanly to an empty DB.
  migrateDeploy(pg.url);
  project.provide('databaseUrl', pg.url);
}

export async function teardown() {
  await pg?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
