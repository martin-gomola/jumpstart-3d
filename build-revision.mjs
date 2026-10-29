import { execFileSync } from 'node:child_process';

export function buildRevision(root, env = process.env) {
  const provided = env.JUMPSTART_BUILD_REVISION || env.RENDER_GIT_COMMIT || env.GITHUB_SHA;
  if (provided) {
    if (!/^[a-f0-9]{7,40}(-dirty)?$/i.test(provided)) throw new Error('Build revision must be a Git hash, optionally followed by -dirty');
    const [hash, dirty] = provided.toLowerCase().split('-');
    return hash.slice(0, 8) + (dirty ? '-dirty' : '');
  }
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return git(['rev-parse', '--short=8', 'HEAD']) + (git(['status', '--porcelain']) ? '-dirty' : '');
  } catch { return 'unversioned'; }
}
