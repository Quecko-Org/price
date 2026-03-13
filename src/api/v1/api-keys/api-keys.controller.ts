

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-keys.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('api-keys')
export class ApiKeysController {

  constructor(private apiService: ApiKeysService) {}

  // generate key
  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Req() req, @Body() dto: CreateApiKeyDto) {
    return this.apiService.create(req.user, dto);
  }

  // list keys
  @UseGuards(AuthGuard('jwt'))
  @Get()
  list(@Req() req) {
    return this.apiService.list(req.user.id);
  }

  // delete key
  @UseGuards(AuthGuard('jwt'))

  @Delete(':id')
  delete(@Req() req, @Param('id') id: number) {
    return this.apiService.delete(req.user.id, id);
  }
}