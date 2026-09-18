import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isProd = process.env.NODE_ENV === 'production'

// In production, use the Render persistent disk
// In development, use local paths
const persistentBase = path.join(__dirname, '..', 'persistent')
const repoDataDir = path.join(__dirname, '..', 'data')

const paths = {
  data: isProd ? path.join(persistentBase, 'data') : repoDataDir,
  uploads: isProd ? path.join(persistentBase, 'uploads') : path.join(__dirname, '..', '..', 'frontend', 'public', 'uploads'),
  backups: isProd ? path.join(persistentBase, 'backups') : path.join(__dirname, '..', 'backups'),
  repoData: repoDataDir
}

// Ensure all directories exist
Object.values(paths).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

// In production, seed any missing data files from repo
if (isProd && fs.existsSync(paths.repoData)) {
  const repoFiles = fs.readdirSync(paths.repoData).filter(f => f.endsWith('.json'))
  repoFiles.forEach(f => {
    const persistFile = path.join(paths.data, f)
    const repoFile = path.join(paths.repoData, f)

    if (!fs.existsSync(persistFile)) {
      fs.copyFileSync(repoFile, persistFile)
      console.log(`[Paths] Seeded: ${f}`)
    } else {
      try {
        const persistData = JSON.parse(fs.readFileSync(persistFile, 'utf8'))
        const repoData = JSON.parse(fs.readFileSync(repoFile, 'utf8'))

        const persistEmpty = (Array.isArray(persistData) && persistData.length === 0) ||
          (typeof persistData === 'object' && !Array.isArray(persistData) && Object.keys(persistData).length === 0)
        const repoHasData = (Array.isArray(repoData) && repoData.length > 0) ||
          (typeof repoData === 'object' && !Array.isArray(repoData) && Object.keys(repoData).length > 0)

        if (persistEmpty && repoHasData) {
          fs.copyFileSync(repoFile, persistFile)
          console.log(`[Paths] Restored: ${f} (persistent was empty)`)
        }
      } catch (e) { /* skip */ }
    }
  })
}

export default paths
