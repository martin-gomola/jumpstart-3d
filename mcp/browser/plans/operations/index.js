import * as importModel from "./import.js";
import * as group from "./group.js";
import * as mirror from "./mirror.js";
import * as pattern from "./pattern.js";
import * as pathPattern from "./path-pattern.js";
import * as featurePattern from "./feature-pattern.js";
import * as transform from "./transform.js";
import * as combine from "./combine.js";
import * as modifier from "./modifier.js";
import * as fastener from "./fastener.js";
import * as gear from "./gear.js";
import * as knurl from "./knurl.js";
import * as holePattern from "./hole-pattern.js";
import * as phoneCradle from "./phone-cradle.js";
import * as splitBody from "./split-body.js";
import * as setRole from "./set-role.js";
import * as gridfinity from "./gridfinity.js";
import * as pocket from "./pocket.js";
import * as drawerLayout from "./drawer-layout.js";

// Each operation type owns its input normalization and its native feature builder.
export const OPERATION_TYPES = {
  import: importModel,
  group: group,
  mirror: mirror,
  pattern: pattern,
  pathPattern: pathPattern,
  featurePattern: featurePattern,
  transform: transform,
  combine: combine,
  modifier: modifier,
  fastener: fastener,
  gear: gear,
  knurl: knurl,
  holePattern: holePattern,
  phoneCradle: phoneCradle,
  splitBody: splitBody,
  setRole: setRole,
  gridfinity: gridfinity,
  pocket: pocket,
  drawerLayout: drawerLayout,
};
