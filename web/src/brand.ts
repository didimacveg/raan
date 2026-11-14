// Single place where the product name and its addresses live on the web side (see
// docs/RESEARCH.md §5). If the repository is renamed again, only `repoName` changes.
const owner = 'didimacveg'
const repoName = 'raan'

export const BRAND = {
  name: 'RAAN',
  tagline: 'Open Orbital Intelligence Lab',
  disclaimer: 'Research project, not for operational use',
  author: 'Diego Macías Vega',
  repoName,
  repo: `https://github.com/${owner}/${repoName}`,
  site: `https://${owner}.github.io/${repoName}/`,
} as const
