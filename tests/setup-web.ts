// Web-project test setup: jest-dom matchers + automatic RTL cleanup (no vitest globals).
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// findBy*/waitFor poll for the real condition and return as soon as it holds, so a long ceiling costs
// nothing when green. The 1 s default is too short for React.lazy chunks, which Vite transforms on first
// import and which can take several seconds when the machine is loaded by parallel test workers.
configure({ asyncUtilTimeout: 10_000 })

afterEach(() => cleanup())
