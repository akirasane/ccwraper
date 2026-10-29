// Web-project test setup: jest-dom matchers + automatic RTL cleanup (no vitest globals).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
