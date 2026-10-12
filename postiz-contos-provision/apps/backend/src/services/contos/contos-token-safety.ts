import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const POS_TOKEN = /pos_[A-Za-z0-9]+/g;

/**
 * Prevent accidental leakage of pos_ tokens into Nest exception messages
 * that get serialized to clients. Response bodies that intentionally return
 * access_token to ContOS are left intact (structured JSON field).
 */
@Injectable()
export class ContosTokenLogSafetyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => data)
    );
  }
}

export function redactPosTokens(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(POS_TOKEN, 'pos_[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(redactPosTokens);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'access_token' || k === 'accessToken') {
        // Keep intentional ContOS response field; do not recurse into logging paths.
        out[k] = v;
        continue;
      }
      out[k] = redactPosTokens(v);
    }
    return out;
  }
  return value;
}

export function sanitizeErrorForLog(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return message.replace(POS_TOKEN, 'pos_[REDACTED]');
}
