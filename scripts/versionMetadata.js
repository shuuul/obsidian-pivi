const { prerelease } = require('semver');

/**
 * @param {string} version
 * @returns {boolean}
 */
function isPrereleaseVersion(version) {
  return prerelease(version) !== null;
}

/**
 * @param {string} readme
 * @param {string} version
 * @returns {string}
 */
function replaceReadmeVersionBadge(readme, version) {
  const readmeVersionBadgePattern =
    /(https:\/\/img\.shields\.io\/static\/v1\?label=version&message=)([^&]+)(&color=blue)/;

  if (!readmeVersionBadgePattern.test(readme)) {
    throw new Error('README version badge not found');
  }

  return readme.replace(readmeVersionBadgePattern, `$1${version}$3`);
}

/**
 * Sync stable Obsidian metadata from package.json into manifest, versions, and README.
 *
 * @param {{
 *   packageJson: { version: string };
 *   manifestJson: { version: string; minAppVersion: string };
 *   versionsJson: Record<string, string>;
 *   readme: string;
 * }} input
 * @returns {{
 *   manifestJson: { version: string; minAppVersion: string };
 *   versionsJson: Record<string, string>;
 *   readme: string;
 * }}
 */
function buildStableVersionMetadata({
  packageJson,
  manifestJson,
  versionsJson,
  readme,
}) {
  const nextManifest = { ...manifestJson, version: packageJson.version };
  const nextVersions = {
    ...versionsJson,
    [packageJson.version]: nextManifest.minAppVersion,
  };
  const nextReadme = replaceReadmeVersionBadge(readme, packageJson.version);

  return {
    manifestJson: nextManifest,
    versionsJson: nextVersions,
    readme: nextReadme,
  };
}

/**
 * Build a release manifest asset from the stable root template and package version.
 *
 * @param {{
 *   manifestJson: { version: string; [key: string]: unknown };
 *   packageVersion: string;
 * }} input
 * @returns {{ version: string; [key: string]: unknown }}
 */
function buildReleaseManifest({ manifestJson, packageVersion }) {
  return {
    ...manifestJson,
    version: packageVersion,
  };
}

module.exports = {
  buildReleaseManifest,
  buildStableVersionMetadata,
  isPrereleaseVersion,
  replaceReadmeVersionBadge,
};
