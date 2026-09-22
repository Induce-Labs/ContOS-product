import { IsUUID } from 'class-validator';

/**
 * ContOS → Postiz internal provision body.
 * Extra fields are rejected by ValidationPipe (forbidNonWhitelisted).
 */
export class ProvisionAvatarDto {
  @IsUUID('4')
  avatar_id!: string;
}
