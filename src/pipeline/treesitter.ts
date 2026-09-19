import { Parser, Language } from 'web-tree-sitter'
import pythonWasm from 'tree-sitter-wasm/python/tree-sitter-python.wasm?url'
import yamlWasm from 'tree-sitter-wasm/yaml/tree-sitter-yaml.wasm?url'
import runtimeWasm from 'web-tree-sitter/web-tree-sitter.wasm?url'

let ready: Promise<{ python: Language; yaml: Language }> | null = null

export async function languages() {
  if (!ready) {
    ready = (async () => {
      await Parser.init({
        locateFile: (file: string) => (file.endsWith('.wasm') ? runtimeWasm : file),
      })
      const [python, yaml] = await Promise.all([
        Language.load(pythonWasm),
        Language.load(yamlWasm),
      ])
      return { python, yaml }
    })()
  }
  return ready
}

export async function parseSource(language: 'python' | 'yaml', source: string) {
  const langs = await languages()
  const parser = new Parser()
  parser.setLanguage(language === 'python' ? langs.python : langs.yaml)
  const tree = parser.parse(source)
  if (!tree) throw new Error(`Failed to parse ${language}`)
  return tree
}

export const PYTHON_TAGS = `
(class_definition
  name: (identifier) @name.definition.class)

(function_definition
  name: (identifier) @name.definition.function)

(call
  function: (identifier) @name.reference.call)

(call
  function: (attribute
    attribute: (identifier) @name.reference.call))
`
