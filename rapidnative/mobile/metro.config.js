// Metro, monorepo-aware.
//
// The app lives in mobile/ while npm hoists most packages to the workspace root,
// so Metro has to watch the root and look in both node_modules trees. Without
// this it resolves fine on a fresh install and then mysteriously fails the first
// time a dependency gets hoisted.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Only ever use the two paths above, so a stray parent node_modules cannot leak in.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
