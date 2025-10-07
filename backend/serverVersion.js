const sha = process.env.GIT_COMMIT_SHA || 'dev';
const builtAt = process.env.BUILT_AT || new Date().toISOString();

module.exports = { sha, builtAt };
