import {
  Body,
  Controller,
  HttpException,
  Logger,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ProvisionAvatarDto } from '@gitroom/nestjs-libraries/dtos/contos/provision-avatar.dto';
import { ContosProvisionGuard } from '@gitroom/backend/services/contos/contos-provision.guard';
import { ContosProvisionService } from '@gitroom/backend/services/contos/contos-provision.service';
import { sanitizeErrorForLog } from '@gitroom/backend/services/contos/contos-token-safety';

/**
 * ContOS FastAPI → Postiz machine API.
 * Not for browsers. Not part of Public API. Not SuperAdmin.
 */
@ApiExcludeController()
@UseGuards(ContosProvisionGuard)
@Controller('/internal/contos')
export class ContosInternalController {
  private readonly _logger = new Logger(ContosInternalController.name);

  constructor(private readonly _provision: ContosProvisionService) {}

  @Post('/provision-avatar')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  async provisionAvatar(@Body() body: ProvisionAvatarDto) {
    try {
      return await this._provision.provisionAvatar(body.avatar_id);
    } catch (error) {
      this._logger.error({
        msg: 'contos_provision_failed',
        avatar_id: body.avatar_id,
        error: sanitizeErrorForLog(error),
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        { msg: 'ContOS provision failed.' },
        500
      );
    }
  }

  @Post('/rotate-avatar-token')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  async rotateAvatarToken(@Body() body: ProvisionAvatarDto) {
    try {
      return await this._provision.rotateAvatarToken(body.avatar_id);
    } catch (error) {
      this._logger.error({
        msg: 'contos_rotate_failed',
        avatar_id: body.avatar_id,
        error: sanitizeErrorForLog(error),
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({ msg: 'ContOS token rotate failed.' }, 500);
    }
  }
}
