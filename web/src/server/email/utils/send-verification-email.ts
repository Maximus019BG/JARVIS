import { jwtDecode } from "jwt-decode";
import EmailVerification from "~/emails/email-verification-email";
import { formatEmailDates } from "~/lib/email";
import { getIpLocationString } from "~/lib/ip-location";
import { sendEmail } from "~/server/email";

interface TokenJwtPayload {
  iat: number;
  exp: number;
  [key: string]: unknown;
}

interface sendVerificationEmailProps {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image?: string | null;
    createdAt: Date;
    updatedAt: Date;
    twoFactorEnabled?: boolean | null;
  };
  url: string;
  token: string;
}

export async function sendVerificationEmail(
  { user, url, token }: sendVerificationEmailProps,
  request?: Request,
) {
  const decodedToken = jwtDecode<TokenJwtPayload>(token);

  const requestedFrom = request
    ? await getIpLocationString(request)
    : "Unknown";
  const { requestedAt, relativeExpire } = formatEmailDates({
    requestedAt: new Date(decodedToken.iat * 1000),
    expireAt: new Date(decodedToken.exp * 1000),
  });
  void (await sendEmail({
    to: user.email,
    subject: "Verify your email address",
    body: EmailVerification({
      userName: user.name,
      verificationUrl: url,
      expiresIn: relativeExpire,
      requestedFrom,
      requestedAt,
    }),
  }));
}
