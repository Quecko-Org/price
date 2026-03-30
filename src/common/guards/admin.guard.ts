import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
  } from '@nestjs/common';
  
  @Injectable()
  export class AdminGuard implements CanActivate {
  
    canActivate(context: ExecutionContext): boolean {
  
      const request = context.switchToHttp().getRequest();
      const user = request.user;
  console.log("uuu",user)
      if (!user) {
        throw new ForbiddenException('Unauthorized');
      }
  
      if (user.role !== 'ADMIN') {
        throw new ForbiddenException('Admin access only');
      }
  
      return true;
    }
  }