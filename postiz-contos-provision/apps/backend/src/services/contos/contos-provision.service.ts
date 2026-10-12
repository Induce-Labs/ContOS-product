import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ContosAvatarRepository } from '@gitroom/nestjs-libraries/database/prisma/contos/contos-avatar.repository';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import type { ContosProvisionTx } from '@gitroom/nestjs-libraries/database/prisma/contos/contos-avatar.repository';

export type ContosProvisionResult = {
  organization_id: string;
  created: boolean;
  access_token: string;
};

@Injectable()
export class ContosProvisionService {
  private readonly _logger = new Logger(ContosProvisionService.name);

  constructor(
    private readonly _contosAvatarRepository: ContosAvatarRepository,
    private readonly _oauthRepository: OAuthRepository
  ) {}

  async provisionAvatar(avatarId: string): Promise<ContosProvisionResult> {
    this.assertStripeCompatible();
    const oauthApp = await this.requireContosOAuthApp();

    return this._contosAvatarRepository.withAvatarLock(avatarId, async (tx) => {
      const existing = await this._contosAvatarRepository.findMapping(
        tx,
        avatarId
      );

      if (existing) {
        const token = await this.reuseValidTokenOrFail(tx, {
          oauthAppId: oauthApp.id,
          userId: existing.userId,
          organizationId: existing.organizationId,
        });
        this._logger.log({
          msg: 'contos_provision_reuse',
          avatar_id: avatarId,
          organization_id: existing.organizationId,
          created: false,
        });
        return {
          organization_id: existing.organizationId,
          created: false,
          access_token: token,
        };
      }

      const created =
        await this._contosAvatarRepository.createOwnedOrgUserAndMapping(
          tx,
          avatarId
        );

      const token = await this.mintToken(tx, {
        oauthAppId: oauthApp.id,
        userId: created.userId,
        organizationId: created.organizationId,
      });

      this._logger.log({
        msg: 'contos_provision_create',
        avatar_id: avatarId,
        organization_id: created.organizationId,
        created: true,
      });

      return {
        organization_id: created.organizationId,
        created: true,
        access_token: token,
      };
    });
  }

  /**
   * Explicit token rotation/recovery — not part of normal provision.
   */
  async rotateAvatarToken(avatarId: string): Promise<ContosProvisionResult> {
    this.assertStripeCompatible();
    const oauthApp = await this.requireContosOAuthApp();

    return this._contosAvatarRepository.withAvatarLock(avatarId, async (tx) => {
      const existing = await this._contosAvatarRepository.findMapping(
        tx,
        avatarId
      );
      if (!existing) {
        throw new HttpException(
          {
            msg: 'Avatar is not provisioned. Call provision-avatar first.',
          },
          HttpStatus.NOT_FOUND
        );
      }

      const token = await this.mintToken(tx, {
        oauthAppId: oauthApp.id,
        userId: existing.userId,
        organizationId: existing.organizationId,
      });

      this._logger.log({
        msg: 'contos_token_rotate',
        avatar_id: avatarId,
        organization_id: existing.organizationId,
        created: false,
      });

      return {
        organization_id: existing.organizationId,
        created: false,
        access_token: token,
      };
    });
  }

  private assertStripeCompatible() {
    // PublicAuthMiddleware rejects pos_ orgs without Subscription when Stripe secret is set.
    // ContOS provisioning intentionally creates no Subscription (not ULTIMATE).
    if (process.env.STRIPE_SECRET_KEY) {
      throw new HttpException(
        {
          msg: 'ContOS avatar provisioning requires Postiz without STRIPE_SECRET_KEY (self-host open mode). Org-without-Subscription is incompatible with Stripe-gated PublicAuthMiddleware.',
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private async requireContosOAuthApp() {
    const clientId = process.env.CONTOS_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
      throw new HttpException(
        { msg: 'CONTOS_OAUTH_CLIENT_ID is not configured.' },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        {
          msg: 'ContOS OAuth App not found for CONTOS_OAUTH_CLIENT_ID.',
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return app;
  }

  private async reuseValidTokenOrFail(
    tx: ContosProvisionTx,
    ids: { oauthAppId: string; userId: string; organizationId: string }
  ): Promise<string> {
    const auth = await tx.oAuthAuthorization.findUnique({
      where: {
        oauthAppId_userId_organizationId: ids,
      },
    });

    if (!auth?.accessToken || auth.revokedAt) {
      throw new HttpException(
        {
          msg: 'Provisioned avatar has no valid access token. Call POST /internal/contos/rotate-avatar-token.',
        },
        HttpStatus.CONFLICT
      );
    }

    try {
      const plaintext = AuthService.fixedDecryption(auth.accessToken);
      if (typeof plaintext !== 'string' || !plaintext.startsWith('pos_')) {
        throw new Error('invalid');
      }
      return plaintext;
    } catch {
      throw new HttpException(
        {
          msg: 'Stored access token could not be recovered. Call POST /internal/contos/rotate-avatar-token.',
        },
        HttpStatus.CONFLICT
      );
    }
  }

  private async mintToken(
    tx: ContosProvisionTx,
    ids: { oauthAppId: string; userId: string; organizationId: string }
  ): Promise<string> {
    const plaintext = 'pos_' + makeId(40);
    const encrypted = AuthService.fixedEncryption(plaintext);

    await tx.oAuthAuthorization.upsert({
      where: {
        oauthAppId_userId_organizationId: ids,
      },
      create: {
        oauthAppId: ids.oauthAppId,
        userId: ids.userId,
        organizationId: ids.organizationId,
        accessToken: encrypted,
        authorizationCode: null,
        codeExpiresAt: null,
        revokedAt: null,
      },
      update: {
        accessToken: encrypted,
        authorizationCode: null,
        codeExpiresAt: null,
        revokedAt: null,
      },
    });

    return plaintext;
  }
}
