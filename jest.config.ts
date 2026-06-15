import type { Config } from 'jest';

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',

  roots:     ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],

  // Path alias  @/* → src/*
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // ts-jest: inline tsconfig so Jest gets CommonJS output.
  // "extends" is NOT supported in the inline object — all options listed here.
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target:                   'ES2020',
          module:                   'CommonJS',
          moduleResolution:         'node',
          strict:                   true,
          esModuleInterop:          true,
          allowSyntheticDefaultImports: true,
          skipLibCheck:             true,
          resolveJsonModule:        true,
          types:                    ['jest', 'node'],
          baseUrl:                  '.',
          paths:                    { '@/*': ['src/*'] },
        },
      },
    ],
  },

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};

export default config;
