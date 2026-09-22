import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type ContosProvisionTx = Prisma.TransactionClient;

@Injectable()
export class ContosAvatarRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async withAvatarLock<T>(
    contosAvatarId: string,
    fn: (tx: ContosProvisionTx) => Promise<T>
  ): Promise<T> {
    return this._prisma.$transaction(
      async (tx) => {
        // Serialize concurrent provisions for the same ContOS avatar.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${'contos-avatar:' + contosAvatarId}))
        `;
        return fn(tx);
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  findMapping(tx: ContosProvisionTx, contosAvatarId: string) {
    return tx.contosAvatarOrganization.findUnique({
      where: { contosAvatarId },
    });
  }

  async createOwnedOrgUserAndMapping(
    tx: ContosProvisionTx,
    contosAvatarId: string
  ) {
    const email = `contos-avatar-${contosAvatarId}@contos.internal`;
    const orgName = `ContOS Avatar ${contosAvatarId}`;
    const passwordHash = AuthService.hashPassword(makeId(64));

    const organization = await tx.organization.create({
      data: {
        name: orgName,
        apiKey: AuthService.fixedEncryption(makeId(20)),
        allowTrial: false,
        isTrailing: false,
        // Intentionally no Subscription row (not createMaxUser / not ULTIMATE).
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                email,
                name: `contos-avatar-${contosAvatarId.slice(0, 8)}`,
                password: passwordHash,
                providerName: 'LOCAL',
                providerId: '',
                activated: true,
                isSuperAdmin: false,
                timezone: 0,
              },
            },
          },
        },
      },
      select: {
        id: true,
        users: {
          select: {
            userId: true,
            user: { select: { id: true, isSuperAdmin: true } },
          },
        },
      },
    });

    const userId = organization.users[0]?.userId;
    if (!userId) {
      throw new Error('Failed to create ContOS avatar owner user.');
    }
    if (organization.users[0]?.user?.isSuperAdmin) {
      throw new Error('ContOS avatar owner must not be instance SuperAdmin.');
    }

    const mapping = await tx.contosAvatarOrganization.create({
      data: {
        contosAvatarId,
        organizationId: organization.id,
        userId,
      },
    });

    return {
      mapping,
      organizationId: organization.id,
      userId,
      created: true as const,
    };
  }
}
