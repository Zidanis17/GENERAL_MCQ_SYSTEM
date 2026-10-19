import { readFile, writeFile } from 'node:fs/promises'

const ci = process.argv[2] === '--ci'
const repository = ci ? process.env.GITHUB_REPOSITORY : process.argv[2]
if (!repository || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository) || repository.endsWith('/.') || repository.endsWith('/..')) {
  throw new Error('Provide your public GitHub repository as owner/repo. Example: npm run updates:configure -- your-name/mcq-studio')
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
if (ci) {
  if (process.env.GITHUB_REF_NAME !== `v${manifest.version}`) throw new Error(`The release tag must match package.json: v${manifest.version}`)
  if (process.env.RELEASE_REPOSITORY_VISIBILITY !== 'public') throw new Error('Automatic updates for all users require a public GitHub release repository.')
}
const [owner, repo] = repository.split('/')
manifest.build ??= {}
manifest.build.publish = { provider: 'github', owner, repo, releaseType: 'draft', publishAutoUpdate: true }
await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`Updates configured for https://github.com/${owner}/${repo}/releases`)
console.log('The next installer build will include this update feed. Portable builds remain manual downloads.')
