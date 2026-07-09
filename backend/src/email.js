const nodemailer = require('nodemailer');

/**
 * Constructs and sends a professional HTML payment reminder email via Gmail.
 * In development, redirects the email to the configured GMAIL_USER to avoid emailing fake addresses.
 * 
 * @param {object} invoice - { invoiceId, customer, amount, dueDate, balance, customerEmail }
 */
async function sendOverdueReminderEmail(invoice) {
  const currency = invoice.currency || 'USD';
  const exchangeRate = invoice.exchangeRate || 1;
  const homeAmount = invoice.homeAmount || invoice.amount;
  
  const formatMoney = (val, cur) => {
    if (cur === 'USD') return `$${Number(val).toFixed(2)}`;
    if (cur === 'CAD') return `$${Number(val).toFixed(2)} CAD`;
    if (cur === 'GBP') return `£${Number(val).toFixed(2)} GBP`;
    if (cur === 'EUR') return `€${Number(val).toFixed(2)} EUR`;
    return `${Number(val).toFixed(2)} ${cur}`;
  };

  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASS || '').trim();
  const isDev = process.env.NODE_ENV !== 'production';

  if (!gmailUser || !gmailPass) {
    console.warn('Gmail credentials not fully configured in .env. Skipping email reminder.');
    return { success: false, error: 'Gmail credentials not configured.' };
  }

  const recipient = (invoice.customerEmail || '').trim();
  if (!recipient) {
    console.warn(`No billing email address found for Invoice #${invoice.invoiceId}. Skipping email.`);
    return { success: false, error: 'No recipient email address.' };
  }

  // Determine final recipient and subject prefix based on environment
  let finalTo = recipient;
  let subjectPrefix = '';
  let envNoticeHtml = '';

  if (isDev) {
    finalTo = gmailUser;
    subjectPrefix = '[TEST REMINDER] ';
    envNoticeHtml = `
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
        <p style="margin: 0; font-family: sans-serif; font-size: 13px; color: #b45309; font-weight: bold;">
          ⚠️ Development Redirection Notice
        </p>
        <p style="margin: 4px 0 0 0; font-family: sans-serif; font-size: 12px; color: #78350f;">
          This is an automated test. This email would have been sent to: <strong>${recipient}</strong>.
        </p>
      </div>
    `;
    console.log(`[Dev Mode] Redirecting overdue reminder email for Invoice #${invoice.invoiceId} to ${gmailUser} (original recipient: ${recipient})`);
  } else {
    console.log(`[Production Mode] Sending overdue reminder email for Invoice #${invoice.invoiceId} to ${recipient}`);
  }

  // Calculate days overdue
  const dueDate = new Date(invoice.dueDate);
  const today = new Date();
  const diffTime = Math.max(0, today - dueDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Initialize SMTP transport
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  const subject = `${subjectPrefix}Payment Reminder: Invoice #${invoice.invoiceId} from SME Sync`;

  // Premium, Responsive HTML Email Template
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Reminder</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 20px auto;
          background-color: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
        }
        .header {
          background-color: #0f172a;
          color: #ffffff;
          padding: 32px 24px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .header p {
          margin: 8px 0 0 0;
          color: #94a3b8;
          font-size: 14px;
        }
        .content {
          padding: 32px 24px;
        }
        .salutation {
          font-size: 16px;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 12px;
        }
        .message-body {
          font-size: 15px;
          color: #475569;
          line-height: 1.6;
          margin-bottom: 24px;
        }
        .alert-card {
          background-color: #fff5f5;
          border-left: 4px solid #ef4444;
          padding: 16px;
          border-radius: 6px;
          margin-bottom: 24px;
        }
        .alert-card p {
          margin: 0;
          font-size: 14px;
          color: #991b1b;
          line-height: 1.5;
        }
        .details-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 28px;
        }
        .details-table th {
          background-color: #f1f5f9;
          color: #475569;
          font-size: 12px;
          text-transform: uppercase;
          font-weight: 600;
          padding: 10px 12px;
          text-align: left;
          border-bottom: 2px solid #e2e8f0;
        }
        .details-table td {
          padding: 12px;
          font-size: 14px;
          color: #1e293b;
          border-bottom: 1px solid #e2e8f0;
        }
        .details-table tr:last-child td {
          border-bottom: none;
        }
        .amount-due {
          font-size: 16px;
          font-weight: 700;
          color: #b91c1c;
        }
        .btn-container {
          text-align: center;
          margin-bottom: 28px;
        }
        .btn {
          display: inline-block;
          background-color: #2563eb;
          color: #ffffff !important;
          text-decoration: none;
          font-size: 15px;
          font-weight: 600;
          padding: 12px 28px;
          border-radius: 8px;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
        }
        .footer {
          background-color: #f8fafc;
          border-top: 1px solid #e2e8f0;
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: #64748b;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <div class="header">
          <h1>Payment Overdue Notice</h1>
          <p>SME Invoice Sync Automations</p>
        </div>

        <!-- Content -->
        <div class="content">
          ${envNoticeHtml}

          <div class="salutation">Hello ${invoice.customer},</div>
          
          <div class="message-body">
            This is a friendly reminder that invoice <strong>#${invoice.invoiceId}</strong> remains unpaid. We would appreciate it if you could review the invoice and arrange for payment at your earliest convenience.
          </div>

          <!-- Overdue Warning -->
          <div class="alert-card">
            <p>
              <strong>Status:</strong> Overdue (${diffDays} days past due date). Please complete payment to avoid any service disruptions or late fee assessments.
            </p>
          </div>

          <!-- Invoice Details Table -->
          <table class="details-table">
            <thead>
              <tr>
                <th>Invoice Details</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Invoice Number</strong></td>
                <td>#${invoice.invoiceId}</td>
              </tr>
              <tr>
                <td><strong>Due Date</strong></td>
                <td>${invoice.dueDate}</td>
              </tr>
              <tr>
                <td><strong>Total Amount</strong></td>
                <td>${formatMoney(invoice.amount, currency)}</td>
              </tr>
              <tr>
                <td><strong>Remaining Balance</strong></td>
                <td class="amount-due">${formatMoney(invoice.balance, currency)}</td>
              </tr>
              ${currency !== 'USD' ? `
              <tr>
                <td><strong>Home Currency Equiv.</strong></td>
                <td>${formatMoney(homeAmount, 'USD')} (approx. @ ${Number(exchangeRate).toFixed(4)})</td>
              </tr>
              ` : ''}
            </tbody>
          </table>

          <!-- Call to Action -->
          <div class="btn-container">
            <a href="#" class="btn">View & Pay Invoice</a>
          </div>

          <div class="message-body" style="font-size: 14px; color: #64748b;">
            Thank you for your business. If you have already processed this payment or believe there is an error, please contact our support team.
          </div>
        </div>

        <!-- Footer -->
        <div class="footer">
          <strong>SME Invoice Sync System</strong><br>
          Automated Accounts Receivable Management<br>
          <span style="font-size: 11px;">This is an automated reminder. Please do not reply directly to this email.</span>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send the email
  try {
    const info = await transporter.sendMail({
      from: `"SME Sync Billing" <${gmailUser}>`,
      to: finalTo,
      subject: subject,
      html: htmlContent,
    });

    console.log(`Email reminder successfully sent for Invoice #${invoice.invoiceId}. MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`Nodemailer error sending email for Invoice #${invoice.invoiceId}:`, error.message);
    throw error;
  }
}

module.exports = {
  sendOverdueReminderEmail,
};
