
import { Controller, Patch, Body, Param, Delete } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/user.dto';


@Controller('users')
export class UserController {
  constructor(private readonly usersService: UserService) {}

  // Update profile
  @Patch(':id')
  async updateProfile(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(+id, dto);
  }

  // Delete user
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(+id);
  }
}