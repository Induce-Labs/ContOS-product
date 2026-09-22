/**
 * Standalone Node test harness for ContOS provision logic
 * (no full Postiz monorepo install required).
 *
 * Run: node postiz-contos-provision/test/run-provision-tests.mjs
 */

import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

const POS_TOKEN = /pos_[A-Za-z0-9]+/g;

function sanitizeErrorForLog(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return message.replace(POS_TOKEN, 'pos_[REDACTED]');
}

function secretsEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Minimal in-memory model of provision + public-api token→org resolution */
function createStore() {
  const mappings = new Map(); // avatarId -> { organizationId, userId }
  const tokens = new Map(); // `${app}:${user}:${org}` -> plaintext pos_
  const integrations = new Map(); // orgId -> [{ id, name }]
  const appId = 'oauth-app';

  return {
    provision(avatarId) {
      if (mappings.has(avatarId)) {
        const m = mappings.get(avatarId);
        const key = `${appId}:${m.userId}:${m.organizationId}`;
        const token = tokens.get(key);
        if (!token) {
          const err = new Error('CONFLICT_ROTATE');
          err.status = 409;
          throw err;
        }
        return { organization_id: m.organizationId, created: false, access_token: token };
      }
      const organizationId = `org-${avatarId.slice(0, 8)}`;
      const userId = `user-${avatarId.slice(0, 8)}`;
      mappings.set(avatarId, { organizationId, userId });
      const token = `pos_${avatarId.replace(/-/g, '').slice(0, 40)}`;
      tokens.set(`${appId}:${userId}:${organizationId}`, token);
      integrations.set(organizationId, []);
      return { organization_id: organizationId, created: true, access_token: token };
    },
    rotate(avatarId) {
      const m = mappings.get(avatarId);
      if (!m) {
        const err = new Error('NOT_FOUND');
        err.status = 404;
        throw err;
      }
      const token = `pos_rot_${Date.now()}_${avatarId.slice(0, 8)}`;
      tokens.set(`${appId}:${m.userId}:${m.organizationId}`, token);
      return { organization_id: m.organizationId, created: false, access_token: token };
    },
    resolveOrg(token) {
      for (const [key, value] of tokens.entries()) {
        if (value === token) return key.split(':')[2];
      }
      return null;
    },
    listIntegrations(token) {
      const org = this.resolveOrg(token);
      if (!org) return null;
      return integrations.get(org) || [];
    },
    addIntegration(orgId, integration) {
      const list = integrations.get(orgId) || [];
      list.push(integration);
      integrations.set(orgId, list);
    },
  };
}

function run() {
  const avatarA = '11111111-1111-1111-1111-111111111111';
  const avatarB = '22222222-2222-2222-2222-222222222222';
  const store = createStore();

  const a1 = store.provision(avatarA);
  assert.equal(a1.created, true);
  assert.match(a1.access_token, /^pos_/);

  const a2 = store.provision(avatarA);
  assert.equal(a2.created, false);
  assert.equal(a2.access_token, a1.access_token, 'idempotent reuse, no rotate');

  const b1 = store.provision(avatarB);
  assert.notEqual(a1.organization_id, b1.organization_id);
  assert.notEqual(a1.access_token, b1.access_token);

  store.addIntegration(a1.organization_id, { id: 'li-a', name: 'LinkedIn A' });
  store.addIntegration(b1.organization_id, { id: 'li-b', name: 'LinkedIn B' });

  const intsA = store.listIntegrations(a1.access_token);
  const intsB = store.listIntegrations(b1.access_token);
  assert.deepEqual(intsA.map((i) => i.id), ['li-a']);
  assert.deepEqual(intsB.map((i) => i.id), ['li-b']);
  assert.equal(
    intsA.some((i) => i.id === 'li-b'),
    false,
    'Avatar A token must not see Avatar B integrations'
  );
  assert.equal(store.resolveOrg(a1.access_token), a1.organization_id);
  assert.notEqual(store.resolveOrg(a1.access_token), b1.organization_id);

  const rotated = store.rotate(avatarA);
  assert.notEqual(rotated.access_token, a1.access_token);
  assert.equal(store.listIntegrations(a1.access_token), null);
  assert.deepEqual(store.listIntegrations(rotated.access_token).map((i) => i.id), ['li-a']);

  assert.match(
    sanitizeErrorForLog('boom pos_abcdefghijklmnopqrstuvwxyz0123456789ab'),
    /pos_\[REDACTED\]/
  );
  assert.equal(secretsEqual('abc', 'abc'), true);
  assert.equal(secretsEqual('abc', 'abd'), false);

  console.log('PASS: provision idempotency, rotate separation, A/B isolation, log redaction');
}

run();
