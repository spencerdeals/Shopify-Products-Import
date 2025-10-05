let warned = false;

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.warn(msg);
}

const cfg = {
  TORSO_DATABASE_URL: process.env.TORSO_DATABASE_URL || '',
  TORSO_AUTH_TOKEN: process.env.TORSO_AUTH_TOKEN || '',
  ADMIN_KEY: process.env.ADMIN_KEY || '',
};

if (!cfg.TORSO_DATABASE_URL || !cfg.TORSO_AUTH_TOKEN) {
  warnOnce('⚠️  TORSO_DATABASE_URL or TORSO_AUTH_TOKEN not configured - DB persistence disabled');
}

module.exports = cfg;
