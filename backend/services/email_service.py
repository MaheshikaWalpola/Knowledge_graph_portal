import smtplib
from email.message import EmailMessage
from core.config import settings

def send_verification_email(to_email: str, token: str):
    verify_url = f"{settings.FRONTEND_BASE_URL}/verify-email?token={token}"

    msg = EmailMessage()
    msg["Subject"] = "Verify Your Email – Knowledge Graph Portal"
    msg["From"] = settings.MAIL_FROM
    msg["To"] = to_email

    # -------- HTML email version ----------
    msg.add_alternative(
        f"""
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    
    <h2 style="color:#222;">Welcome to the Knowledge Graph Portal!</h2>

    <p>Hello,</p>

    <p>
      Thank you for creating an account. To complete your registration,
      please confirm your email address by clicking the button below.
    </p>

    <a href="{verify_url}" 
       style="
          display:inline-block;
          padding: 12px 22px;
          background-color:#1a73e8;
          color:white;
          text-decoration:none;
          border-radius:6px;
          font-size:16px;
          margin:20px 0;
       ">
      Verify Email
    </a>
    
    <br>

    <p>
      Best regards,<br>
      <strong>Knowledge Graph Portal – VSR Team</strong>
    </p>

  </body>
</html>
"""
        ,
        subtype="html"
    )

    with smtplib.SMTP(settings.MAIL_SERVER, settings.MAIL_PORT) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)

def send_password_reset_email(to_email: str, token: str):
    reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"

    msg = EmailMessage()
    msg["Subject"] = "Reset Your Password – Knowledge Graph Portal"
    msg["From"] = settings.MAIL_FROM
    msg["To"] = to_email

    msg.add_alternative(
        f"""
        <!DOCTYPE html>
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2 style="color:#222;">Password Reset</h2>

            <p>Hello,</p>

            <p>
              Click the button below to reset your password. This link expires in 30 minutes.
            </p>

            <a href="{reset_url}" 
              style="
                  display:inline-block;
                  padding: 12px 22px;
                  background-color:#111827;
                  color:white;
                  text-decoration:none;
                  border-radius:6px;
                  font-size:16px;
                  margin:20px 0;
              ">
              Reset Password
            </a>

            <p style="font-size: 13px; color: #666;">
              If you didn’t request this, you can ignore this email.
            </p>

            <p>
              Best regards,<br>
              <strong>Knowledge Graph Portal – VSR Team</strong>
            </p>
          </body>
        </html>
        """,
        subtype="html",
    )

    with smtplib.SMTP(settings.MAIL_SERVER, settings.MAIL_PORT) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)
