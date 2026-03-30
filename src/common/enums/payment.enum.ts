export enum PaymentStatus {
    CONFIRMED = 'confirmed',
    FAILED = 'failed',
  }
  export enum UserPlan {
    FREE='free',
    BASIC = 'basic',  //99
    GROWTH = 'growth', //299
    PRO = 'pro',//999
  }

  export const PLAN_MAP = {
    1: UserPlan.BASIC, 
    2: UserPlan.GROWTH, // 
    3: UserPlan.PRO, //
  }


  export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN',
  }
  
  export enum UserStatus {
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED',
  }