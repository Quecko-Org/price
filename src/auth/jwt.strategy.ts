import { UserService } from '@/user/user.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

// Read once at module load — log it so you can see what value is actually used
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
console.log('[JwtStrategy] secretOrKey =', JSON.stringify(JWT_SECRET));

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UserService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      JWT_SECRET,   // use the const, never undefined
    });
  }

  async validate(payload: any) {
    console.log('[JwtStrategy] validate called, payload.sub =', payload.sub);
    const user = await this.usersService.user(payload.sub);
    if (!user) throw new UnauthorizedException('User not found');
    return { id: payload.sub, email: payload.email, role: user.role };
  }
}