
import { Controller, Patch, Body, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/user.dto';
import { AuthGuard } from '@nestjs/passport';


@Controller('users')
export class UserController {
  constructor(private readonly usersService: UserService) {}

  // Update profile





  @UseGuards(AuthGuard('jwt'))
  @Patch()
  updateProfile(
    @Req() req,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(req.user.id, dto);

  }

  

  // Delete user   

  @UseGuards(AuthGuard('jwt'))
  @Delete()
  deleteUser(
    @Req() req,
  ) {
    return this.usersService.deleteUser(req.user.id);

  }

}