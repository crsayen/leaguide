function normalize(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function compareSemver(a, b) {
  const left = normalize(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalize(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

async function checkForUpdate(currentVersion, repoOwner, repoName) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`, {
      headers: {
        'User-Agent': 'poe2-league-guide'
      }
    });

    if (!response.ok) {
      return null;
    }

    const release = await response.json();
    const latestVersion = normalize(release.tag_name);
    if (!latestVersion) {
      return null;
    }

    const available = compareSemver(latestVersion, currentVersion) > 0;
    return {
      available,
      version: latestVersion,
      downloadUrl: Array.isArray(release.assets) && release.assets[0] ? release.assets[0].browser_download_url : null,
      releaseUrl: release.html_url || null
    };
  } catch (error) {
    return null;
  }
}

module.exports = {
  checkForUpdate
};
