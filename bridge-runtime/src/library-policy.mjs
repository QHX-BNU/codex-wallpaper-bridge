/** Shared library rules for inventory, direct playback and future rotation. */
export const CONTENT_RATINGS = Object.freeze(['everyone', 'pg13', 'mature', 'unrated']);
export const MAX_LIBRARY_ITEMS = 10_000;

export function normalizeRating(value) {
  const key = String(value ?? '').toLowerCase().replace(/[\s_-]/g, '');
  return CONTENT_RATINGS.includes(key) ? key : 'unrated';
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

export function normalizeLibrary(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const assets = [];
  const seen = new Set();
  for (const asset of (Array.isArray(value.assets) ? value.assets : []).slice(0, MAX_LIBRARY_ITEMS)) {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.hash ?? '') || asset.id !== `upload:${asset.hash}`
      || !new RegExp(`^${asset.hash}\\.(?:jpg|png|mp4)$`).test(asset.fileName ?? '')
      || !Number.isSafeInteger(asset.size) || asset.size <= 0 || seen.has(asset.id)) continue;
    seen.add(asset.id);
    assets.push({
      id: asset.id, hash: asset.hash, fileName: asset.fileName, size: asset.size,
      type: asset.fileName.endsWith('.mp4') ? 'video' : 'image',
      title: typeof asset.title === 'string' ? asset.title.slice(0, 200) : '导入壁纸',
      rating: normalizeRating(asset.rating),
    });
  }
  const hiddenIds = [...new Set((Array.isArray(value.hiddenIds) ? value.hiddenIds : [])
    .filter(validId))].slice(0, MAX_LIBRARY_ITEMS);
  const ratings = Object.fromEntries(Object.entries(value.ratings && typeof value.ratings === 'object'
    && !Array.isArray(value.ratings) ? value.ratings : {})
    .filter(([id]) => validId(id)).slice(0, MAX_LIBRARY_ITEMS)
    .map(([id, rating]) => [id, normalizeRating(rating)]));
  return {
    directory: typeof value.directory === 'string' && value.directory.length <= 4096
      && !value.directory.includes('\0') ? value.directory : null,
    assets, hiddenIds, ratings,
    allowedRatings: Array.isArray(value.allowedRatings)
      ? [...new Set(value.allowedRatings.filter((rating) => CONTENT_RATINGS.includes(rating)))]
      : [...CONTENT_RATINGS],
  };
}

export function projectPolicy(project, config) {
  const library = config?.library ?? {};
  const rating = normalizeRating((Object.hasOwn(library.ratings ?? {}, project.id) ? library.ratings[project.id] : undefined)
    ?? project.contentRating ?? project.metadata?.contentRating ?? project.rating);
  const hidden = (library.hiddenIds ?? []).includes(project.id);
  const allowed = (library.allowedRatings ?? CONTENT_RATINGS).includes(rating);
  return { contentRating: rating, hidden, eligible: !hidden && allowed };
}

export function eligibleProjects(projects, config) {
  return projects.filter((project) => project.eligible !== false && !project.hidden
    && projectPolicy(project, config).eligible);
}
