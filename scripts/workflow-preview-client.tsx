import { createRoot } from 'react-dom/client'
import { Root } from '../src/client/shell/Root.tsx'
import { createRuntime } from '../src/client/runtime.ts'
import { installStyles } from '../src/client/styles.ts'
import { zh } from '../src/client/locales.ts'

installStyles()
const runtime = createRuntime({ async call(_channel, endpoint, payload) {
  return (await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })).json()
} })
runtime.open()
createRoot(document.getElementById('root')!).render(<Root runtime={runtime} t={(key, params = {}) =>
  (zh[key] ?? key).replace(/\{(\w+)\}/gu, (_, name) => String(params[name] ?? ''))} />)
