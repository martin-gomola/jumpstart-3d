import metadata from '../package.json' with { type: 'json' };
import { VERSION } from './version.js';

export const PRODUCT_NAME = 'JumpStart 3D Studio';
export const STUDIO_VERSION = metadata.version;
export const EDITOR_VERSION = VERSION;
export const BUILD_REVISION = typeof __JUMPSTART_BUILD_REVISION__ === 'undefined' ? 'unversioned' : __JUMPSTART_BUILD_REVISION__;
export const VERSION_LABEL = `Studio ${STUDIO_VERSION} · Editor ${EDITOR_VERSION} · Build ${BUILD_REVISION}`;
