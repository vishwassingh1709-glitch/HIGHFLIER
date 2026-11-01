import nodemailer from 'nodemailer';
import { env, isSmtpConfigured } from '../../config/env.js';
import { logger } from '../../config/logger.js';

let transporter = null;
const outbox = [];

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || 587,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
    });
  }
  return transporter;
};

/**
 * Sends transactional email. In test mode messages are captured in an in-memory
 * outbox (never exposed over HTTP). Without SMTP configuration, only development
 * builds log a preview; production never logs message bodies.
 */
export const sendMail = async ({ to, subject, text, html, context }) => {
  if (env.isTest) {
    outbox.push({ to, subject, text, html, context, sentAt: new Date() });
    return { mock: true };
  }

  if (!isSmtpConfigured) {
    logger.warn({ to, subject }, 'SMTP is not configured; transactional email skipped');
    if (env.isDevelopment) {
      logger.info({ to, subject, preview: text }, '[MOCK EMAIL] Development email preview');
    }
    return { mock: true };
  }

  await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  return { mock: false };
};

export const getMailOutbox = () => outbox;
export const clearMailOutbox = () => {
  outbox.length = 0;
};

export const sendVerificationEmail = async (user, token) => {
  const link = `${env.API_BASE_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Verify your HIGHFLIER email address',
    text: `Hello ${user.name},\n\nVerify your HIGHFLIER account by opening this link:\n${link}\n\nThis link expires in ${env.EMAIL_VERIFICATION_TTL_HOURS} hours. If you did not create an account, ignore this email.`,
    html: `<p>Hello ${user.name},</p><p>Verify your HIGHFLIER account by clicking <a href="${link}">this link</a>.</p><p>This link expires in ${env.EMAIL_VERIFICATION_TTL_HOURS} hours.</p>`,
    context: { token, type: 'email_verification' }
  });
};

export const sendPasswordResetEmail = async (user, token) => {
  const link = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Reset your HIGHFLIER password',
    text: `Hello ${user.name},\n\nReset your password using this link:\n${link}\n\nThis link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes. If you did not request this, ignore this email.`,
    html: `<p>Hello ${user.name},</p><p>Reset your password by clicking <a href="${link}">this link</a>.</p><p>This link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes.</p>`,
    context: { token, type: 'password_reset' }
  });
};

export const sendOrderConfirmationEmail = async (user, order) =>
  sendMail({
    to: user.email,
    subject: `HIGHFLIER order ${order.orderNumber} confirmed`,
    text: `Hello ${user.name},\n\nThank you for your order ${order.orderNumber}. Total: INR ${order.total}.`,
    context: { orderNumber: order.orderNumber }
  });
