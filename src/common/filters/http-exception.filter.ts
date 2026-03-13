// src/common/filters/http-exception.filter.ts
import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
  
  @Catch()
  export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
  
      let status = HttpStatus.INTERNAL_SERVER_ERROR;
      let message: any = 'Internal server error';
      let reason: any = null;
  
      if (exception instanceof HttpException) {
        status = exception.getStatus();
        const res = exception.getResponse();
        message =
          typeof res === 'string'
            ? res
            : (res as any).message || res;
        reason = (res as any).reason || null;
      } else if (exception instanceof Error) {
        reason = exception.message;
      }
  
      console.error('API ERROR:', exception);
  
      response.status(status).json({
        success: false,
        statusCode: status,
        message,
        reason, // <-- detailed reason
        path: request.url,
        timestamp: new Date().toISOString(),
      });
    }
  }