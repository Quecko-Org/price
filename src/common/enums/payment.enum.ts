export enum PaymentStatus {
    CONFIRMED = 'confirmed',
    FAILED = 'failed',
  }
  export enum UserPlan {
    BASIC = 'basic',
    GROWTH = 'growth',
    PRO = 'pro',
  }

  export const PLAN_MAP = {
    0: UserPlan.BASIC,
    1: UserPlan.GROWTH,
    2: UserPlan.PRO,
  }