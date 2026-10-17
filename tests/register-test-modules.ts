import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    if (resolved.url.startsWith('file:') && resolved.url.endsWith('.json') && context.importAttributes.type === undefined) {
      // Match Vite's JSON imports while retaining Node's native JSON validation and cache.
      return { ...resolved, importAttributes: { ...context.importAttributes, type: 'json' } }
    }
    return resolved
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
    const source = readFileSync(new URL(url), 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    }
  },
})
