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
 * 3. `api/src/core/**` must not import `rconService` or the MatchZy event
 *    types (`types/matchzy-events`) by any path, relative or not.
 *
 * `registry.ts` and `types.ts` themselves are not restricted. There are no
 * exceptions: the legacy allowlist emptied out in PR 7b and was removed in
 * PR 14, so every rule is an error everywhere.
 *
 * Paths are resolved against the importing file, so `../cs2`, `../../cs2/x` and
 * `../integrations/cs2/index` are all caught regardless of depth, which a glob
 * in `no-restricted-imports` cannot do for sibling integrations.
 */

import path from 'node:path';

const SRC_ROOT = /^(.*?[\\/](?:api|client)[\\/]src)(?:[\\/]|$)/;
const SHARED = new Set(['registry', 'types']);

/**
 * Game-specific modules the core must never import, by any path (3.0 PR 14).
 * Rule 1 already rejects them where they live today (`integrations/cs2/**`);
 * this also catches a copy, a re-export shim or an alias path that puts them
 * back under a core directory. Matched on the last path segment, without
 * extension, of every import specifier in `api/src/core/**`.
 */
const CORE_FORBIDDEN_MODULES = new Set(['rconService', 'matchzy-events', 'matchzy-events.types']);

function isCoreDir(root, filename) {
  const rel = path.relative(root, filename).split(path.sep);
  return rel[0] === 'core' && /[\\/]api[\\/]src$/.test(root);
}

function forbiddenCoreModule(source) {
  const last = source.split(/[\\/]/).pop() ?? '';
  const base = last.replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
  return CORE_FORBIDDEN_MODULES.has(base) ? base : null;
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
      coreForbiddenModule:
        "api/src/core must not import '{{name}}' by any path. The core sees games only through integrations/types (NormalizedEvent) and the registry.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    const rootMatch = SRC_ROOT.exec(filename);
    if (!rootMatch) return {};
    const root = rootMatch[1];
    const self = classify(root, filename);
    if (!self || self.kind === 'shared') return {};

    const inCore = self.kind === 'core' && isCoreDir(root, filename);

    function check(node, source) {
      if (typeof source !== 'string') return;
      if (inCore) {
        const name = forbiddenCoreModule(source);
        if (name) context.report({ node, messageId: 'coreForbiddenModule', data: { name } });
      }
      if (!source.startsWith('.')) return;
      const absTarget = path.resolve(path.dirname(filename), source);
      const target = classify(root, absTarget);
      if (!target || target.kind === 'core') return;

      if (self.kind === 'core') {
        if (target.kind === 'integration') {
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
