import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn("WARNING: RESEND_API_KEY is missing from the .env file.");
}

const resend = new Resend(apiKey || 're_dummy_key_to_prevent_crash');
const FROM_EMAIL = 'Ruumies <admin@ruumies.com>'; 

const generateEmailHtml = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td align="center" style="background-color: #2563eb; padding: 30px 20px;">
              <img src="https://res.cloudinary.com/dirodfnej/image/upload/v1776789515/download_mjg6vv.png" alt="Ruumies Logo" style="max-width: 150px; height: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px; color: #334155; font-size: 16px; line-height: 1.6;">
              <h2 style="margin-top: 0; margin-bottom: 20px; color: #0f172a; font-size: 22px;">${title}</h2>
              ${content}
            </td>
          </tr>
          <tr>
            <td align="center" style="background-color: #f1f5f9; padding: 24px; color: #64748b; font-size: 13px;">
              <p style="margin: 0;">Have questions? Reach out to our <a href="mailto:support@ruumies.com" style="color: #2563eb; text-decoration: none; font-weight: 500;">support team</a>.</p>
              <p style="margin: 8px 0 0 0;">&copy; ${new Date().getFullYear()} Ruumies. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

async function sendCoreEmail({ to, subject, html }) {
  try {
    const data = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    return { success: true, data };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error };
  }
}

export async function sendEscrowSecuredEmail(ruumieEmail, amount) {
  const content = `
    <p style="margin-bottom: 24px;">Your payment has been successfully processed. We are safely holding your funds in escrow until your move-in is confirmed.</p>
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Amount Secured</p>
      <p style="margin: 8px 0 0 0; color: #1e3a8a; font-size: 32px; font-weight: 700;">₦${amount.toLocaleString()}</p>
    </div>
    <p style="margin-bottom: 16px;"><strong>What happens next?</strong></p>
    <ul style="margin-top: 0; margin-bottom: 24px; padding-left: 20px; color: #475569;">
      <li style="margin-bottom: 8px;">You have <strong>7 days</strong> to move into the property.</li>
      <li style="margin-bottom: 8px;">Once you move in, confirm it on your Ruumies dashboard.</li>
      <li>If there are any issues with the property, you can raise a dispute before the 7 days expire.</li>
    </ul>
  `;

  return sendCoreEmail({
    to: ruumieEmail,
    subject: 'Payment Secured in Escrow',
    html: generateEmailHtml('Your funds are secure', content)
  });
}

export async function sendOwnerEscrowAlert(ownerEmail, amount) {
  const content = `
    <p style="margin-bottom: 24px;">A tenant has successfully secured your property. The rent payment is currently locked safely in our escrow system.</p>
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Funds in Escrow</p>
      <p style="margin: 8px 0 0 0; color: #1e3a8a; font-size: 32px; font-weight: 700;">₦${amount.toLocaleString()}</p>
    </div>
    <p style="margin-bottom: 24px;">Once the tenant confirms they have moved in (or automatically after 7 days if no dispute is raised), these funds will be released directly to your payout queue.</p>
    <p style="margin: 0;">Please prepare the property and ensure a smooth move-in experience for your new tenant.</p>
  `;

  return sendCoreEmail({
    to: ownerEmail,
    subject: 'Property Secured: Escrow Payment Received',
    html: generateEmailHtml('Property Secured', content)
  });
}

export async function sendPayoutApprovedEmail(ownerEmail, amount) {
  const content = `
    <p style="margin-bottom: 24px;">Our administration team has officially approved and processed your property payout.</p>
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #166534; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Amount Transferred</p>
      <p style="margin: 8px 0 0 0; color: #14532d; font-size: 32px; font-weight: 700;">₦${amount.toLocaleString()}</p>
    </div>
    <p style="margin-bottom: 24px;">The funds have been dispatched to your registered bank account. Please note that it may take a short while to reflect depending on your bank's processing times.</p>
    <p style="margin: 0;">Thank you for hosting with Ruumies.</p>
  `;

  return sendCoreEmail({
    to: ownerEmail,
    subject: 'Escrow Payout Approved',
    html: generateEmailHtml('Payout Initiated', content)
  });
}

export async function sendRefundEmail(userEmail, amount, reason) {
  const content = `
    <p style="margin-bottom: 24px;">This email is to confirm that your escrow payment has been cancelled and a refund has been initiated.</p>
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #991b1b; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Amount Refunded</p>
      <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 32px; font-weight: 700;">₦${amount.toLocaleString()}</p>
    </div>
    <div style="background-color: #ffffff; border-left: 4px solid #ef4444; padding: 16px; margin-bottom: 24px; color: #475569;">
      <p style="margin: 0; font-size: 14px;"><strong>Reason for cancellation:</strong><br/>${reason}</p>
    </div>
    <p style="margin: 0;">The funds will be returned to your original payment method. Standard processing times apply.</p>
  `;

  return sendCoreEmail({
    to: userEmail,
    subject: 'Escrow Refund Processed',
    html: generateEmailHtml('Refund Processed', content)
  });
}