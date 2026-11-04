import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite gibt beim Laden eine ExperimentalWarning aus
    env: { NODE_NO_WARNINGS: '1' },
  },
});
