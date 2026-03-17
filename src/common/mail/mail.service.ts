import { Injectable, Logger } from '@nestjs/common';
import sgMailPkg from '@sendgrid/mail';

const sgMail = sgMailPkg;
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY||"");

  }

  async sendMail(options: {
    to: string;
    templateId:string;
    dynamicTemplateData?: Record<string, any>;
  }) {
    try {
      console.log("dynamicTemplateData",options.dynamicTemplateData)
      const msg: any = {
        to: options.to,
        from: { email: 'no-reply@em2287.price.agency', name: 'Price Agency' },    
            templateId:options.templateId,
        dynamicTemplateData: options.dynamicTemplateData,
        categories: ['verification'],


      };
  
        

      const info = await sgMail.send(msg);
      console.log("iiiiiii",info)
      this.logger.log(`Email sent to ${options.to}`);
      return info;
    } catch (err) {
      console.log("asssssssssssssss",err,err.response.body.errors)
      this.logger.error(`Failed to send email to ${options.to}`, err,err.response.body);
      throw err;
    }
  }}