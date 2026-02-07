const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends an email using the Resend SDK.
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @returns {Promise<Object>} - Returns an object with messageId for compatibility
 */
const sendEmail = async (to, subject, html) => {
    try {
        const { data, error } = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: to,
            subject: subject,
            html: html,
        });

        if (error) {
            console.error("[Mailer] Error sending email via Resend:", error);
            throw new Error(error.message);
        }

        console.log(`[Mailer] Email sent via Resend: ${data.id}`);
        // Map 'id' to 'messageId' to maintain compatibility with existing routes.js code
        return { messageId: data.id, ...data };
    } catch (error) {
        console.error("[Mailer] Critical error sending email:", error);
        throw error;
    }
};

const nodemailer = require('nodemailer');

/**
 * Sends an email using Gmail SMTP (Nodemailer).
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @returns {Promise<Object>} - Returns info object
 */
const sendGmail = async (to, subject, html) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const info = await transporter.sendMail({
            from: `"Soporte DocenteAI" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: html
        });

        console.log(`[Mailer] Email sent via Gmail: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error("[Mailer] Critical error sending email via Gmail:", error);
        throw error;
    }
};

module.exports = { sendEmail, sendGmail };
