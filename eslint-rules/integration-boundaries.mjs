/**
 * ESLint rule: game integration boundaries.
 *
 * Layout (same for the API and the client):
 *
 *   <src>/integrations/types.ts      shared contract
 *   <src>/integrations/registry.ts   the only way to reach an integration
 *   <src>/integrations/<id>/**       one integration (cs2, later manual-report, …)
 *
 * Rules, for every static import, re-export, dynamic `import()` and `require()`
 * with a relative path:
 *
 * 1. Core code (anything under <src> outside integrations/) may import only
 *    `integrations/registry` and `integrations/types`, never an integration's
 *    own files.
 * 2. An integration may import its own files and `integrations/types`, but not
 *    another integration and not the registry (the registry imports every
 *    integration, so that would be a cycle and a back door to the others).
 *
 * `registry.ts` and `types.ts` themselves are not restricted. Rule 1 has an
 * explicit, shrinking list of legacy exceptions (`LEGACY_CORE_IMPORTS`).
 *
 * Paths are resolved against the importing file, so `../cs2`, `../../cs2/x` and
 * `../integrations/cs2/index` are all caught regardless of depth, which a glob
 * in `no-restricted-imports` cannot do for sibling integrations.
 */

import path from 'node:path';

const SRC_ROOT = /^(.*?[\\/](?:api|client)[\\/]src)(?:[\\/]|$)/;
const SHARED = new Set(['registry', 'types']);

/**
 * Legacy exceptions to rule 1: core files that still call CS2 code directly,
 * until the PR that puts that call behind the interface. Each entry is one
 * exact (core file, integration module) pair, so the list can only shrink:
 * a new import, even of an already-listed module from another file, fails.
 *
 * Keys are the importing file relative to the repo (`api/src/...`); values are
 * the imported modules relative to that src root, without extension.
 */
const LEGACY_CORE_IMPORTS = {
  // TODO(PR 6b): the match lifecycle moves to core/matchLifecycle.ts and takes
  // NormalizedEvents; until then the CS2 adapter hands it the MatchZy event.
  'api/src/services/matchEventHandler.ts': ['integrations/cs2/events/matchzy-events.types'],
  // TODO(PR 7a): loading a match onto a server becomes Cs2ServerPool.allocate().
  'api/src/services/matchLoadingService.ts': [
    'integrations/cs2/services/rconService',
    'integrations/cs2/services/serverInitializationService',
    'integrations/cs2/services/serverStatusService',
    'integrations/cs2/utils/matchzyRconCommands',
    'integrations/cs2/utils/serverTurnover',
  ],
  // TODO(PR 7a/7b): server selection moves to integrations/cs2/allocation.ts, the rest to core/scheduler.ts.
  'api/src/services/matchAllocationService.ts': [
    'integrations/cs2/services/rconService',
    'integrations/cs2/services/serverConnectivityService',
    'integrations/cs2/services/serverService',
    'integrations/cs2/services/serverStatusService',
    'integrations/cs2/utils/serverTurnover',
  ],
  // TODO(PR 7a): re-sending the webhook config on recovery becomes an allocation-side restart.
  'api/src/services/matchRecoveryService.ts': [
    'integrations/cs2/services/serverInitializationService',
  ],
  // TODO(PR 7b): /start and /restart preflight and ending matches on servers go through capacity()/cancel().
  'api/src/routes/tournament.ts': [
    'integrations/cs2/services/cs2UpdateService',
    'integrations/cs2/services/rconService',
    'integrations/cs2/services/serverInitializationService',
    'integrations/cs2/services/serverService',
  ],
  // TODO(PR 7a): /reallocate and /force-cancel go through restart()/cancel().
  'api/src/routes/matches.ts': ['integrations/cs2/services/rconService'],
  // TODO(PR 7a): the match's server status comes from the allocation side of the interface.
  'api/src/routes/players.ts': ['integrations/cs2/services/serverStatusService'],
  'api/src/routes/teamMatch.ts': ['integrations/cs2/services/serverStatusService'],
  // TODO(PR 7a): test helper that primes the server status cache.
  'api/src/routes/test.ts': ['integrations/cs2/services/serverStatusService'],
};

function isLegacyCoreImport(root, filename, absTarget) {
  const repoRoot = path.dirname(path.dirname(root));
  const importer = path.relative(repoRoot, filename).split(path.sep).join('/');
  const allowed = LEGACY_CORE_IMPORTS[importer];
  if (!allowed) return false;
  const target = path
    .relative(root, absTarget)
    .split(path.sep)
    .join('/')
    .replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
  return allowed.includes(target);
}

/** 'core' | { integration: id } | 'shared' | null (outside a src root) */
function classify(root, absPath) {
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts[0] !== 'integrations') return { kind: 'core' };
  if (parts.length === 1) return { kind: 'shared', name: 'index' };
  const name = parts[1].replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
  if (parts.length === 2 && SHARED.has(name)) return { kind: 'shared', name };
  if (parts.length === 2 && name === 'index') return { kind: 'shared', name };
  return { kind: 'integration', id: name };
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep core and game integrations behind integrations/registry and integrations/types' },
    schema: [],
    messages: {
      coreToIntegration:
        "Core code must not import the '{{id}}' integration directly. Go through integrations/registry (getIntegration / integrationForMatch) and integrations/types.",
      crossIntegration:
        "The '{{from}}' integration must not import the '{{id}}' integration. Integrations share only integrations/types.",
      integrationToRegistry:
        "The '{{from}}' integration must not import integrations/{{name}}. Integrations may only import integrations/types and their own files.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    const rootMatch = SRC_ROOT.exec(filename);
    if (!rootMatch) return {};
    const root = rootMatch[1];
    const self = classify(root, filename);
    if (!self || self.kind === 'shared') return {};

    function check(node, source) {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const absTarget = path.resolve(path.dirname(filename), source);
      const target = classify(root, absTarget);
      if (!target || target.kind === 'core') return;

      if (self.kind === 'core') {
        if (target.kind === 'integration') {
          if (isLegacyCoreImport(root, filename, absTarget)) return;
          context.report({ node, messageId: 'coreToIntegration', data: { id: target.id } });
        } else if (target.name === 'index') {
          context.report({ node, messageId: 'coreToIntegration', data: { id: 'integrations/index' } });
        }
        return;
      }

      // self is an integration
      if (target.kind === 'integration' && target.id !== self.id) {
        context.report({ node, messageId: 'crossIntegration', data: { from: self.id, id: target.id } });
      } else if (target.kind === 'shared' && target.name !== 'types') {
        context.report({
          node,
          messageId: 'integrationToRegistry',
          data: { from: self.id, name: target.name },
        });
      }
    }

    const fromSource = (node) => node.source && check(node.source, node.source.value);

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node.source, node.source.value);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal'
        ) {
          check(node.arguments[0], node.arguments[0].value);
        }
      },
    };
  },
};

export default {
  meta: { name: 'integration-boundaries' },
  rules: { 'integration-boundaries': rule },
};
