export enum PaymentStatus {
    CONFIRMED = 'confirmed',
    FAILED = 'failed',
  }
  export enum UserPlan {
    BASIC = 'basic',  //99
    GROWTH = 'growth', //299
    PRO = 'pro',//999
  }

  export const PLAN_MAP = {
    1: UserPlan.BASIC, 
    2: UserPlan.GROWTH, // 
    3: UserPlan.PRO, //
  }