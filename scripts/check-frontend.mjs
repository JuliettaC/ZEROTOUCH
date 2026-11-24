import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as prettier from 'prettier'

async function checkDirectory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'graphify-out') await checkDirectory(file)
    } else if (/\.(js|jsx|css)$/.test(file)) {
      const source = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
      const options = await prettier.resolveConfig(file)
      const formatted = await prettier.format(source, { ...options, filepath: file })
      const lines = formatted.trimEnd().split('\n').length
      if (source !== formatted || lines > 500) {
        console.error(file, lines + ' líneas', source !== formatted ? '(requiere Prettier)' : '')
        process.exitCode = 1
      }
    }
  }
}
await checkDirectory('src')
