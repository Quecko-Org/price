exports = {
    uniswapv3: {
        UNISWAP_FACTORY :process.env.UNISWAP_FACTORY,
            password: process.env.DATABASE_PASSWORD,
      user: process.env.DATABASE_USERNAME,
      host: process.env.DATABASE_HOST,
      dbReader:process.env.DATABASE_DBREADER,
      dialect: process.env.DATABASE_DIALECT,
      pool: process.env.DATABASE_POOL,
      port: process.env.DATABASE_PORT
    }, 
    aws: {
      accessKey: process.env.AWS_ACCESS_KEY,
      accessSecret: process.env.AWS_ACCESS_SECRET,
      s3: {
        bucketName: process.env.AWS_S3_BUCKET_NAME,
        bucketRegion: process.env.AWS_S3_BUCKET_REGION,
        bucketBaseUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_S3_BUCKET_REGION}.amazonaws.com/`,
      },
      cloudfront:{
        baseUrl: 'https://media.quick.shop'
    
      }
    }}