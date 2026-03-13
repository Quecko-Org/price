

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as YAML from 'yamljs';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips properties that are not in the DTO
      forbidNonWhitelisted: true, // throws error for extra fields
      transform: true, // auto-transforms payloads to DTO instances
      errorHttpStatusCode: 400,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Load YAML
  const swaggerDocument = YAML.load('src/docs/openapi.yaml');

  SwaggerModule.setup('api-docs', app, swaggerDocument);



  await app.listen(process.env.PORT ?? 3000);


}
// process.on('unhandledRejection', (reason, promise) => {
//   console.error('Unhandled Rejection at:', promise, 'reason:', reason);
// });
bootstrap();