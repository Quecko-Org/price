

import { UserPlan } from '@/common/enums/payment.enum';
import { IsEmail, IsNotEmpty, IsString, IsBoolean, IsEnum } from 'class-validator';



export class SignUpDto {
  @IsEmail({}, { message: 'Email must be valid' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;


  @IsBoolean()
  newsletter?: boolean;

  @IsBoolean()
  agreeToTerms: boolean;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email must be valid' })
  email: string;
}


export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  token: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  newPassword: string;
}