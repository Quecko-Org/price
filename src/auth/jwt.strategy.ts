import { UserService } from '@/user/user.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { NotFoundError } from 'rxjs';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {

  constructor(    private readonly usersService: UserService,
    ) {

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // read token from header
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'supersecretkey',
    });
  }
  async validate(payload: any) {
    const user = await this.usersService.user(payload.sub); // fetch full user from DB
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: payload.sub,
      email: payload.email,
      role:user.role

    };
  }
}