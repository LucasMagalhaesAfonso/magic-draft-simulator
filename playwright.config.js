const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testMatch: '**/*.spec.js',
  retries: 0,
  workers: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx http-server . -p 8080 -c-1',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'cards',
      testDir: './tests/cards',
      timeout: 60000,
    },
    {
      name: 'completeness',
      testDir: './tests/completeness',
      timeout: 120000,
    },
    {
      name: 'validation',
      testDir: './tests/validation',
      timeout: 120000,
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      timeout: 90000,
    },
    {
      name: 'simulation',
      testDir: './tests/simulation',
      timeout: 300000,
    },
    {
      name: 'effect-runtime',
      testDir: './tests/completeness',
      testMatch: /effect-runtime\.spec\.js/,
      timeout: 120000,
    },
    {
      name: 'deep-audit',
      testDir: './tests/validation',
      testMatch: /deep-oracle-audit\.spec\.js/,
      timeout: 120000,
    },
    {
      name: 'human-interactive',
      testDir: './tests/integration',
      testMatch: /human-interactive\.spec\.js/,
      timeout: 120000,
    },
    {
      name: 'keyword-enforcement',
      testDir: './tests/integration',
      testMatch: /keyword-enforcement\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'multi-card',
      testDir: './tests/integration',
      testMatch: /multi-card-interactions\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'phase-timing',
      testDir: './tests/integration',
      testMatch: /phase-timing\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'mana-edge',
      testDir: './tests/integration',
      testMatch: /mana-edge-cases\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'oracle-parser',
      testDir: './tests/integration',
      testMatch: /oracle-parser\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'mechanic-coverage',
      testDir: './tests/integration',
      testMatch: /mechanic-coverage\.spec\.js/,
      timeout: 90000,
    },
    {
      name: 'static-validation',
      testDir: './tests/validation',
      testMatch: /static-validation\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'triggered-validation',
      testDir: './tests/validation',
      testMatch: /triggered-validation\.spec\.js/,
      timeout: 60000,
    },
    {
      name: 'cards-scenarios',
      testDir: './tests/cards',
      testMatch: /tdm-scenarios\.spec\.js/,
      timeout: 90000,
    },
    {
      name: 'tdm-all-cards',
      testDir: './tests/cards',
      testMatch: /tdm-all-cards\.spec\.js/,
      timeout: 120000,
    },
    {
      name: 'tdm-runtime-coverage',
      testDir: './tests/cards',
      testMatch: /tdm-runtime-coverage\.spec\.js/,
      timeout: 120000,
    },
  ],
});
