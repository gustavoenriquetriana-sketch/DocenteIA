const nodemailer = require('nodemailer');

// Pre-configure the transporter with strict IPv4 enforcement
const transporter = nodemailer.createTransport({
    service: 'gmail', // Automatically sets host to smtp.gmail.com and port to 465 (secure: true)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4, // FORCE IPv4 - Critical for Railway/Gmail issues
    logger: true, // Log to console for debugging
    debug: true   // Include debug info in logs
});

/**
 * Sends an email using the centralized transporter.
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @returns {Promise<void>}
 */
const sendEmail = async (to, subject, html) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        html: html
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[Mailer] Email sent: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error("[Mailer] Error sending email:", error);
        throw error;
    }
};

module.exports = { sendEmail };
