

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
  app.enableCors({
    origin: '*', // allow all origins (for development)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });


  const publicDoc: any = YAML.load('src/docs/openapi.yaml') || {};
  const adminDoc: any = YAML.load('src/docs/admin-dashboard.yaml') || {};
// Merge paths and components
const mergedDoc: any = {
  openapi: publicDoc.openapi || '3.0.0',
  info: publicDoc.info || { title: 'API', version: '1.0.0' },
  servers: publicDoc.servers || [],
  paths: { 
    ...publicDoc.paths, 
    ...adminDoc.paths 
  },
  components: {
    schemas: { 
      ...publicDoc.components?.schemas, 
      ...adminDoc.components?.schemas 
    },
    securitySchemes: {
      ...publicDoc.components?.securitySchemes,
      ...adminDoc.components?.securitySchemes,
    },
    responses: {
      ...publicDoc.components?.responses,
      ...adminDoc.components?.responses,
    },
  },
};
SwaggerModule.setup('api-docs', app, mergedDoc);
  

  await app.listen(process.env.PORT ?? 3000);


}
// process.on('unhandledRejection', (reason, promise) => {
//   console.error('Unhandled Rejection at:', promise, 'reason:', reason);
// });
bootstrap();