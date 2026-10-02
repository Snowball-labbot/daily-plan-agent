import { withWorkflow } from 'workflow/next'
import path from 'node:path'
export default withWorkflow({ output: 'standalone', poweredByHeader: false, turbopack: { root: path.resolve('../..') }, experimental: { externalDir: true } })
