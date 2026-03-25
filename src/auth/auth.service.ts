
import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import {  SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UserEntity } from '@/user/entities/user.entity';
import { randomBytes } from 'crypto';
import { addMinutes } from 'date-fns';
import { MailService } from '@/common/mail/mail.service';
import { UserPlan } from '@/common/enums/payment.enum';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,

  ) {}

  async signup(dto: SignUpDto) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({ 
      email: dto.email,
      name: dto.name,
      password: hashedPassword,
      newsletter: dto.newsletter ?? false,
      agreeToTerms: dto.agreeToTerms,
    
  });
    await this.userRepo.save(user);

    return this.generateToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateToken(user);
  }

  generateToken(user: UserEntity) {
    return {
      access_token: this.jwtService.sign({ sub: user.id, email: user.email }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.currentPlan,
      },
    };
  }





  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    // Generate a secure token
    const token = randomBytes(32).toString('hex');
console.log("jjj",token)
    // Set expiration (30 minutes)
    user.resetPasswordToken = token;
    user.resetPasswordExpires = addMinutes(new Date(), 30);

    await this.userRepo.save(user);
    // Send email with reset link
    const resetUrl = `${process.env.baseUrl}/forgetpassword?token=${token}`;


   

    await this.mailService.sendMail({
      to: user.email,
      templateId : process.env.SENDGRID_PASSWORD_RESET || "",
      dynamicTemplateData: {
        name: user.name,
        resetUrl:resetUrl,
        date: new Date().toLocaleDateString(),
      },
    });

    return { message: 'Password reset link sent. Please check your email.' };
  }



  async resetPassword(token: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: MoreThan(new Date()), // token not expired
      },
    });
  
    if (!user) throw new BadRequestException('Invalid or expired token');
  
    // Hash new password
    user.password = await bcrypt.hash(newPassword, 10);
  
    // Clear token & expiry
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
  
    await this.userRepo.save(user);
  
    return { message: 'Password updated successfully' };
  }
}