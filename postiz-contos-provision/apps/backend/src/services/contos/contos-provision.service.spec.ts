/**
 * ContOS provision unit tests (Approach B).
 * Run from Postiz repo root after deps:
 *   pnpm exec jest apps/backend/src/services/contos/contos-provision.service.spec.ts --coverage=false
 */

jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: (v: string) => `enc:${v}`,
    fixedDecryption: (v: string) =>
      typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : '',
    hashPassword: (v: string) => `hash:${v}`,
  },
}));

jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: (n: number) => 'x'.repeat(n),
}));

import { ContosProvisionService } from './contos-provision.service';

describe('ContosProvisionService', () => {
  const avatarA = '11111111-1111-1111-1111-111111111111';
  const avatarB = '22222222-2222-2222-2222-222222222222';
  const orgA = 'org-a';
  const orgB = 'org-b';
  const userA = 'user-a';
  const userB = 'user-b';
  const appId = 'oauth-app-contos';

  let oauthRepo: {
    getAppByClientId: jest.Mock;
  };
  let contosRepo: {
    withAvatarLock: jest.Mock;
    findMapping: jest.Mock;
    createOwnedOrgUserAndMapping: jest.Mock;
  };
  let tx: {
    oAuthAuthorization: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let service: ContosProvisionService;
  let tokenStore: Map<string, { accessToken: string | null; revokedAt: Date | null }>;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    process.env.CONTOS_OAUTH_CLIENT_ID = 'pca_test_contos';

    tokenStore = new Map();

    tx = {
      oAuthAuthorization: {
        findUnique: jest.fn(async ({ where }) => {
          const key = `${where.oauthAppId_userId_organizationId.oauthAppId}:${where.oauthAppId_userId_organizationId.userId}:${where.oauthAppId_userId_organizationId.organizationId}`;
          const row = tokenStore.get(key);
          if (!row) return null;
          return { accessToken: row.accessToken, revokedAt: row.revokedAt };
        }),
        upsert: jest.fn(async ({ where, create, update }) => {
          const ids = where.oauthAppId_userId_organizationId;
          const key = `${ids.oauthAppId}:${ids.userId}:${ids.organizationId}`;
          const existing = tokenStore.get(key);
          if (!existing) {
            tokenStore.set(key, {
              accessToken: create.accessToken,
              revokedAt: null,
            });
          } else {
            tokenStore.set(key, {
              accessToken: update.accessToken,
              revokedAt: null,
            });
          }
          return {};
        }),
      },
    };

    contosRepo = {
      withAvatarLock: jest.fn(async (_id: string, fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx)
      ),
      findMapping: jest.fn(),
      createOwnedOrgUserAndMapping: jest.fn(),
    };

    oauthRepo = {
      getAppByClientId: jest.fn(async () => ({ id: appId, clientId: 'pca_test_contos' })),
    };

    service = new ContosProvisionService(
      contosRepo as never,
      oauthRepo as never
    );
  });

  it('creates org+token on first provision', async () => {
    contosRepo.findMapping.mockResolvedValue(null);
    contosRepo.createOwnedOrgUserAndMapping.mockResolvedValue({
      organizationId: orgA,
      userId: userA,
      created: true,
      mapping: { contosAvatarId: avatarA },
    });

    const result = await service.provisionAvatar(avatarA);
    expect(result.created).toBe(true);
    expect(result.organization_id).toBe(orgA);
    expect(result.access_token.startsWith('pos_')).toBe(true);
    expect(tx.oAuthAuthorization.upsert).toHaveBeenCalled();
  });

  it('reuses the same token on idempotent provision (not rotation)', async () => {
    contosRepo.findMapping.mockResolvedValue({
      contosAvatarId: avatarA,
      organizationId: orgA,
      userId: userA,
    });
    const plaintext = 'pos_' + 'y'.repeat(40);
    tokenStore.set(`${appId}:${userA}:${orgA}`, {
      accessToken: `enc:${plaintext}`,
      revokedAt: null,
    });

    const result = await service.provisionAvatar(avatarA);
    expect(result.created).toBe(false);
    expect(result.access_token).toBe(plaintext);
    expect(tx.oAuthAuthorization.upsert).not.toHaveBeenCalled();
  });

  it('does not mint on provision when token missing — requires rotate', async () => {
    contosRepo.findMapping.mockResolvedValue({
      contosAvatarId: avatarA,
      organizationId: orgA,
      userId: userA,
    });

    try {
      await service.provisionAvatar(avatarA);
      throw new Error('expected conflict');
    } catch (error: any) {
      expect(error?.getStatus?.() ?? error?.status).toBe(409);
    }
  });

  it('rotate mints a new token explicitly', async () => {
    contosRepo.findMapping.mockResolvedValue({
      contosAvatarId: avatarA,
      organizationId: orgA,
      userId: userA,
    });
    tokenStore.set(`${appId}:${userA}:${orgA}`, {
      accessToken: 'enc:pos_old',
      revokedAt: null,
    });

    const result = await service.rotateAvatarToken(avatarA);
    expect(result.access_token.startsWith('pos_')).toBe(true);
    expect(result.access_token).not.toBe('pos_old');
    expect(tx.oAuthAuthorization.upsert).toHaveBeenCalled();
  });

  it('isolates Avatar A token from Avatar B organization binding', async () => {
    // Provision A
    contosRepo.findMapping.mockResolvedValueOnce(null);
    contosRepo.createOwnedOrgUserAndMapping.mockResolvedValueOnce({
      organizationId: orgA,
      userId: userA,
      created: true,
      mapping: {},
    });
    const a = await service.provisionAvatar(avatarA);

    // Provision B
    contosRepo.findMapping.mockResolvedValueOnce(null);
    contosRepo.createOwnedOrgUserAndMapping.mockResolvedValueOnce({
      organizationId: orgB,
      userId: userB,
      created: true,
      mapping: {},
    });
    const b = await service.provisionAvatar(avatarB);

    expect(a.organization_id).not.toBe(b.organization_id);
    expect(a.access_token).not.toBe(b.access_token);

    const keyA = `${appId}:${userA}:${orgA}`;
    const keyB = `${appId}:${userB}:${orgB}`;
    expect(tokenStore.has(keyA)).toBe(true);
    expect(tokenStore.has(keyB)).toBe(true);
    expect(tokenStore.get(keyA)?.accessToken).not.toBe(
      tokenStore.get(keyB)?.accessToken
    );

    // Public API middleware resolves token → organization only.
    // Simulate findByAccessToken org binding:
    const resolveOrg = (token: string) => {
      for (const [key, row] of tokenStore.entries()) {
        if (row.accessToken === `enc:${token}`) {
          return key.split(':')[2];
        }
      }
      return null;
    };
    expect(resolveOrg(a.access_token)).toBe(orgA);
    expect(resolveOrg(b.access_token)).toBe(orgB);
    expect(resolveOrg(a.access_token)).not.toBe(orgB);
  });

  it('refuses to run when STRIPE_SECRET_KEY is set (no Subscription created)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    try {
      await service.provisionAvatar(avatarA);
      throw new Error('expected unavailable');
    } catch (error: any) {
      expect(error?.getStatus?.() ?? error?.status).toBe(503);
    }
  });
});

describe('token log safety', () => {
  const { sanitizeErrorForLog } = require('./contos-token-safety');

  it('redacts pos_ tokens from error strings', () => {
    const raw = 'failed with pos_abcdefghijklmnopqrstuvwxyz0123456789ab';
    expect(sanitizeErrorForLog(raw)).toContain('pos_[REDACTED]');
    expect(sanitizeErrorForLog(raw)).not.toContain('pos_abcdefgh');
  });
});
