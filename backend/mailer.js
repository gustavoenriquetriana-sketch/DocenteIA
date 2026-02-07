const nodemailer = require('nodemailer');

// Pre-configure the transporter with strict IPv4 enforcement
// Pre-configure the transporter with strict IPv4 and Port 587 (TLS)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4, // FORCE IPv4 - Critical for Railway
    tls: {
        rejectUnauthorized: false
    },
    logger: true,
    debug: true
});

// Verify connection configuration
transporter.verify(function (error, success) {
    if (error) {
        console.log('[Mailer] Error de conexión SMTP:', error);
    } else {
        console.log('[Mailer] Servidor SMTP listo para enviar mensajes');
    }
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
