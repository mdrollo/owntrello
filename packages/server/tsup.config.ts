import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace-Paket wird ins Bundle übernommen; fastify & Co. bleiben in node_modules.
  noExternal: ['@owntrello/shared'],
  // "node:"-Präfix behalten: node:sqlite existiert nur mit Präfix
  removeNodeProtocol: false,
});
