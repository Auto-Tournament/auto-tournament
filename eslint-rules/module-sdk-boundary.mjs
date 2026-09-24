/**
 * ESLint rule: a client game module reaches the platform only through the SDK.
 *
 * Layout:
 *
 *   client/src/module-sdk/**          the platform code a module may import
 *   client/src/integrations/types.ts  the slot contract
 *   client/src/integrations/<id>/**   one module (cs2, manual-report, …)
 *
 * For every static import, re-export, dynamic `import()` and `require()` in a
 * file under `client/src/integrations/<id>/**`:
 *
 * 1. A relative path may resolve to the module's own files,
 *    `integrations/types` or `module-sdk`. Anything else in `client/src`
 *    (hooks, utils, contexts, components, types, paths, …), or outside it, is
 *    platform code the module would not have if it were built on its own:
 *    `platformImport`. Type-only imports count too; a separate build cannot
 *    typecheck against core's source either. Another integration and the
 *    registry are left to `integration-boundaries`, which already forbids them.
 * 2. A bare specifier that is a subpath of a shared package but not itself
 *    shared (`@mui/material/Box`) would not resolve through the host's import
 *    map, or would bundle a second copy with its own theme context:
 *    `sharedSubpath`. Import from the package root instead.
 * 3. A package that holds state the host owns (`notistack`: the host's
 *    snackbar provider; `socket.io-client`: the host's connection) must come
 *    through the SDK, not a bundled copy: `hostPackage`. Type-only imports
 *    are erased and do not count.
 *
 * Any other bare package is the module's own business: it bundles it.
 *
 * Paths are resolved against the importing file, so `../../hooks/x` and
 * `../../../utils/api` are caught at any depth, as in integration-boundaries.
 *
 * This is the boundary of item 8c in DESIGN-module-client-api.md. It is
 * registered as an **error**, except on the two CS2 tournament setup steps
 * that item 10 is rewriting, where it is still a warning (eslint.config.mjs).
 */

import path from 'node:path';

const CLIENT_SRC = /^(.*?[\\/]client[\\/]src)(?:[\\/]|$)/;
const EXT = /\.(d\.)?[cm]?[jt]sx?$/;

/** Shared singletons the host hands to modules (DESIGN-module-client-api.md §2.5). */
const SHARED_PACKAGES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@mui/material',
  '@mui/material/utils',
  '@mui/material/styles',
  '@emotion/react',
  '@emotion/styled',
  'react-router-dom',
  'react-i18next',
  'i18next',
]);

/** Packages whose state the host owns; a module gets them through the SDK. */
const HOST_PACKAGES = new Set(['notistack', 'socket.io-client']);

/** The package name of a bare specifier: `@scope/name` or `name`. */
function packageName(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** { id } when `filename` is inside an integration's own directory, else null. */
function integrationOf(root, filename) {
  const parts = path.relative(root, filename).split(path.sep);
  if (parts[0] !== 'integrations' || parts.length < 3) return null;
  return { id: parts[1] };
}

/** null when the resolved import is allowed, else its path for the message. */
function platformTarget(root, absPath) {
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return path.relative(path.dirname(root), absPath);
  const parts = rel.split(path.sep);
  parts[parts.length - 1] = parts[parts.length - 1].replace(EXT, '');
  if (parts[0] === 'module-sdk') return null;
  if (parts[0] === 'integrations') {
    // Own files, the contract, and (for integration-boundaries to judge) the
    // registry, the integrations index and other integrations.
    return null;
  }
  if (parts[parts.length - 1] === 'index' && parts.length > 1) parts.pop();
  return parts.join('/');
}

function isTypeOnly(node) {
  if (!node) return false;
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  const specs = node.specifiers ?? [];
  return (
    specs.length > 0 &&
    specs.every((s) => s.importKind === 'type' || s.exportKind === 'type')
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Client game modules import platform code only through client/src/module-sdk and integrations/types',
    },
    schema: [],
    messages: {
      platformImport:
        "The '{{from}}' module imports platform code '{{target}}'. A module reaches the platform only through module-sdk and integrations/types.",
      sharedSubpath:
        "'{{source}}' is not a shared package. Import from '{{pkg}}' so the module uses the host's copy.",
      hostPackage:
        "The '{{from}}' module imports '{{source}}' directly. Its state belongs to the host; it has to come through module-sdk.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    const rootMatch = CLIENT_SRC.exec(filename);
    if (!rootMatch) return {};
    const root = rootMatch[1];
    const self = integrationOf(root, filename);
    if (!self) return {};

    function check(node, source, decl) {
      if (typeof source !== 'string') return;

      if (source.startsWith('.')) {
        const target = platformTarget(root, path.resolve(path.dirname(filename), source));
        if (target) context.report({ node, messageId: 'platformImport', data: { from: self.id, target } });
        return;
      }

      if (SHARED_PACKAGES.has(source)) return;
      const pkg = packageName(source);
      if (SHARED_PACKAGES.has(pkg)) {
        context.report({ node, messageId: 'sharedSubpath', data: { source, pkg } });
        return;
      }
      if (HOST_PACKAGES.has(pkg) && !isTypeOnly(decl)) {
        context.report({ node, messageId: 'hostPackage', data: { from: self.id, source } });
      }
    }

    const fromSource = (node) => node.source && check(node.source, node.source.value, node);

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node.source, node.source.value, null);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal'
        ) {
          check(node.arguments[0], node.arguments[0].value, null);
        }
      },
    };
  },
};

export default {
  meta: { name: 'module-sdk-boundary' },
  rules: { 'module-sdk-boundary': rule },
};
