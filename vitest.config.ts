import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Ensure tests and source code resolve the same axios instance so
      // vi.mock('axios') applies to the module imported by stockDataService.
      axios: path.resolve(__dirname, 'node_modules/axios'),
    },
  },
  test: {
    globals: false,
    mockReset: false,
  },
});
