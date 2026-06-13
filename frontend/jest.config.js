/**
 * Jest 設定 — ブラウザ不要 (jsdom) で Angular のユニットテストを実行する。
 * 実行: npm test
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
