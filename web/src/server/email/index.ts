import { Resend } from "resend";
import "server-only";
import { env } from "~/env";

const resend = new Resend(env.RESEND_API_KEY);

interface sendEmailProps {
  to: string;
  subject: string;
  body: React.ReactNode;
}

export const sendEmail = async ({ to, subject, body }: sendEmailProps) => {
  const { error } = await resend.emails.send({
    from: "JARVIS <no-reply@jarvisweb.cloud>",
    to,
    subject,
    react: body,
  });

  if (error) console.error(error);
};
