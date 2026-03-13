

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';

import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-keys.dto';

@Controller('api-keys')
export class ApiKeysController {

  constructor(private apiService: ApiKeysService) {}

  // generate key
  @Post()
  create(@Req() req, @Body() dto: CreateApiKeyDto) {
    return this.apiService.create(req.user, dto);
  }

  // list keys
  @Get()
  list(@Req() req) {
    return this.apiService.list(req.user.id);
  }

  // delete key
  @Delete(':id')
  delete(@Req() req, @Param('id') id: number) {
    return this.apiService.delete(req.user.id, id);
  }
}