import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn("WARNING: RESEND_API_KEY is missing from the .env file.");
}

const resend = new Resend(apiKey);
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

export async function sendCoreEmail({ to, subject, html }) {
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

export async function sendRoleAssignedEmail(userEmail, role) {
  const roleDisplayName = role === 'super_admin' ? 'Super Administrator' : 'Support';
  const content = `
    <p style="margin-bottom: 24px;">Congratulations! You have been granted administrative access to the Ruumies platform.</p>
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Role Assigned</p>
      <p style="margin: 8px 0 0 0; color: #1e3a8a; font-size: 24px; font-weight: 700;">${roleDisplayName}</p>
    </div>
    <p style="margin-bottom: 16px;"><strong>What does this mean?</strong></p>
    <ul style="margin-top: 0; margin-bottom: 24px; padding-left: 20px; color: #475569;">
      <li style="margin-bottom: 8px;">You now have access to administrative features and tools.</li>
      <li style="margin-bottom: 8px;">Please use your powers responsibly to help maintain the platform.</li>
      <li>If you have any questions about your role, contact our support team.</li>
    </ul>
    <p style="margin: 0;">Welcome to the Ruumies admin team!</p>
  `;

  return sendCoreEmail({
    to: userEmail,
    subject: `Administrative Access Granted: ${roleDisplayName}`,
    html: generateEmailHtml('Admin Access Granted', content)
  });
}

export async function sendOtpEmail(userEmail, code) {
  const content = `
    <p style="margin-bottom: 24px;">Use the code below to verify your email address. This code expires in 10 minutes.</p>
    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <p style="margin: 0; color: #0f172a; font-size: 32px; font-weight: 700; letter-spacing: 0.15em;">${code}</p>
    </div>
    <p style="margin: 0;">If you did not request this code, please ignore this email.</p>
  `;

  return sendCoreEmail({
    to: userEmail,
    subject: 'Your Ruumies verification code',
    html: generateEmailHtml('Verify your email', content)
  });
}


export async function sendWelcomeEmail(email, firstName) {
  try {
    const data = await resend.emails.send({
      from: 'Ruumies <admin@ruumies.com>', 
      to: email,
      subject: 'Welcome to Ruumies! Next Step: Your Profile',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2>Welcome aboard, ${firstName}!</h2>
          <p>Your email is verified and your account is secure. You are one step away from finding your perfect roommate or property.</p>
          <p>To get the best matches, we need to know a little bit more about what you are looking for.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://app.ruumies.com/dashboard/complete-account" 
               style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Complete Your Profile
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">If you have any questions about how escrows or roommate matching works, our support team is always here to help.</p>
        </div>
      `
    });
    return data;
  } catch (error) {
    console.error("Welcome Email Error:", error);
    throw error;
  }
}

export async function sendPropertyApprovalEmail({ propertyId, propertyTitle, ownerEmail, ownerName }) {
  const content = `
    <p style="margin-bottom: 24px;">Good news! Your property has been reviewed and <strong>approved</strong> by our administration team.</p>
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px 0; color: #166534; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Property Approved</p>
      <p style="margin: 0; color: #15803d; font-size: 18px; font-weight: 600; word-break: break-word;">${propertyTitle}</p>
    </div>
    <p style="margin-bottom: 16px;"><strong>What happens next?</strong></p>
    <ul style="margin-top: 0; margin-bottom: 24px; padding-left: 20px; color: #475569;">
      <li style="margin-bottom: 8px;">Your property is now live on the Ruumies platform.</li>
      <li style="margin-bottom: 8px;">You can start receiving inquiries from interested tenants.</li>
      <li>Visit your dashboard to manage applications and schedule viewings.</li>
    </ul>
    <p style="margin: 0;">Thank you for listing your property with Ruumies!</p>
  `;

  return sendCoreEmail({
    to: ownerEmail,
    subject: `Property Approved: ${propertyTitle}`,
    html: generateEmailHtml(`Welcome, ${ownerName}! Your Property is Approved`, content)
  });
}

export async function sendPropertyRejectionEmail({ propertyId, propertyTitle, ownerEmail, ownerName }) {
  const content = `
    <p style="margin-bottom: 24px;">Thank you for listing your property on Ruumies. After careful review, our administration team has <strong>declined</strong> the listing at this time.</p>
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px 0; color: #991b1b; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Property Not Approved</p>
      <p style="margin: 0; color: #b91c1c; font-size: 18px; font-weight: 600; word-break: break-word;">${propertyTitle}</p>
    </div>
    <p style="margin-bottom: 16px; color: #475569;">This decision may be due to various reasons including listing details, documentation, or compliance with our platform guidelines.</p>
    <p style="margin-bottom: 24px; color: #475569;"><strong>What can you do?</strong></p>
    <ul style="margin-top: 0; margin-bottom: 24px; padding-left: 20px; color: #475569;">
      <li style="margin-bottom: 8px;">Review the listing requirements on our platform.</li>
      <li style="margin-bottom: 8px;">Update your property information and re-submit for review.</li>
      <li>Contact our support team for specific feedback on this rejection.</li>
    </ul>
    <p style="margin: 0;">We value your interest and hope to see your property listed soon!</p>
  `;

  return sendCoreEmail({
    to: ownerEmail,
    subject: `Property Under Review: ${propertyTitle}`,
    html: generateEmailHtml(`Update on Your Property Listing`, content)
  });
}

export async function sendBookingReportEmail({ propertyId, propertyTitle, propertyAddress, reason, bookingId, timestamp }) {
  const formattedDate = new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC'
  });

  const content = `
    <p style="margin-bottom: 24px;">A new booking report has been submitted and requires your attention.</p>
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; color: #0f172a;">
        <tr style="border-bottom: 1px solid #dbeafe;">
          <td style="padding: 12px 0; font-weight: 600; color: #1e40af; width: 40%;">Property Title</td>
          <td style="padding: 12px 0;">${propertyTitle}</td>
        </tr>
        <tr style="border-bottom: 1px solid #dbeafe;">
          <td style="padding: 12px 0; font-weight: 600; color: #1e40af;">Address</td>
          <td style="padding: 12px 0;">${propertyAddress || 'N/A'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #dbeafe;">
          <td style="padding: 12px 0; font-weight: 600; color: #1e40af;">Property ID</td>
          <td style="padding: 12px 0;">${propertyId}</td>
        </tr>
        <tr style="border-bottom: 1px solid #dbeafe;">
          <td style="padding: 12px 0; font-weight: 600; color: #1e40af;">Booking ID</td>
          <td style="padding: 12px 0;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; font-weight: 600; color: #1e40af;">Submitted</td>
          <td style="padding: 12px 0;">${formattedDate}</td>
        </tr>
      </table>
    </div>
    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0 0 8px 0; color: #475569; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Report Reason</p>
      <p style="margin: 0; color: #0f172a; line-height: 1.6;">${reason}</p>
    </div>
    <p style="margin: 24px 0 0 0; color: #64748b; font-size: 14px;">Please log in to your admin dashboard to review and take action on this booking report.</p>
  `;

  return sendCoreEmail({
    to: 'admin@ruumies.com',
    subject: `New Booking Report: ${propertyTitle}`,
    html: generateEmailHtml('New Booking Report', content)
  });
}