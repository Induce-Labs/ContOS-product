import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ContosProvisionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const configured = process.env.CONTOS_PROVISION_SECRET?.trim();
    if (!configured) {
      throw new HttpException(
        { msg: 'ContOS provision endpoint is not configured.' },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    this.assertIpAllowlist(req);

    const header = req.headers.authorization || req.headers.Authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new HttpException({ msg: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
    }
    const presented = header.slice('Bearer '.length).trim();
    if (!this.secretsEqual(presented, configured)) {
      throw new HttpException({ msg: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
    }
    return true;
  }

  private assertIpAllowlist(req: Request) {
    const raw = process.env.CONTOS_PROVISION_IP_ALLOWLIST?.trim();
    if (!raw) {
      return;
    }
    const allowed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.length) {
      return;
    }
    const ip = this.clientIp(req);
    if (!allowed.includes(ip)) {
      throw new HttpException({ msg: 'Forbidden' }, HttpStatus.FORBIDDEN);
    }
  }

  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0].trim();
    }
    return (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
  }

  private secretsEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }
}
