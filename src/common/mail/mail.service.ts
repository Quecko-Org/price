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
      const msg: any = {
        from: {
          email: process.env.SENDGRID_FROM_EMAIL,
          name: process.env.SENDGRID_FROM_NAME || 'Your App',
        },
        to: options.to,
      };

        msg.templateId = process.env.SENDGRID_PAYMENT_CONFIRMATION;
        msg.dynamicTemplateData = options.dynamicTemplateData;
      

      const info = await sgMail.send(msg);
      this.logger.log(`Email sent to ${options.to}`);
      return info;
    } catch (err) {
      console.log("asssssssssssssss",err,err.response.body.errors)
      this.logger.error(`Failed to send email to ${options.to}`, err,err.response.body);
      throw err;
    }
  }}