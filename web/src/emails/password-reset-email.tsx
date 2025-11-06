import { Heading, Hr, Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "~/emails/components/email-layout";
import { EmailButton } from "./components/email-button";
import SecurityNotice from "~/emails/components/email-security-notice";
import RequestInfo from "~/emails/components/email-request-info";

interface Props {
  name: string;
  resetUrl: string;
  expiresIn: string;
  requestedFrom: string;
  requestedAt: string;
}

export default function PasswordResetEmail({
  name = "John Doe",
  resetUrl = "https://example.com/",
  expiresIn = "15 minutes",
  requestedFrom = "127.0.0.1, Amsterdam, NL",
  requestedAt = "1 January 1970, 00:00 UTC",
}: Props) {
  return (
    <EmailLayout preview="Use the following link to reset your JARVIS password">
      <Section className="px-2">
        <Heading as="h2" className="text-2xl font-bold">
          Password reset request
        </Heading>

        <Section className="mb-6">
          <Text className="mb-2 text-base">
            Hi <span className="font-bold">{name}</span>,
          </Text>
          <Text className="mt-0 text-base">
            We received a request to reset your password. You can use the button
            below to securely create a new one.
          </Text>
        </Section>

        <Section className="mb-6 text-center">
          <EmailButton href={resetUrl}>Reset password</EmailButton>
        </Section>
        
        <SecurityNotice expiresIn={expiresIn} />

        <Text className="text-muted-foreground mb-4 text-base">
          Having trouble with the button?{" "}
          <Link href={resetUrl} className="underline">
            Click here
          </Link>{" "}
          to reset your password.
        </Text>

        <Hr className="my-6 border" />

  
        <RequestInfo requestedFrom={requestedFrom} requestedAt={requestedAt} />
      </Section>
    </EmailLayout>
  );
}
