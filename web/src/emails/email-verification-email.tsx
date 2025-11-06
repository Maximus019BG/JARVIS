import { Heading, Hr, Link, Section, Text } from "@react-email/components";
import { EmailButton } from "~/emails/components/email-button";
import { EmailLayout } from "~/emails/components/email-layout";
import SecurityNotice from "~/emails/components/email-security-notice"
import RequestInfo from "~/emails/components/email-request-info"

interface EmailVerificationProps {
  userName: string;
  verificationUrl: string;
  expiresIn: string;
  requestedFrom: string;
  requestedAt: string;
}

export default function EmailVerification({
  userName = "John Doe",
  verificationUrl = "https://example.com/",
  expiresIn = "15 minutes",
  requestedFrom = "127.0.0.1, Amsterdam, NL",
  requestedAt = "1 January 1970, 00:00 UTC",
}: EmailVerificationProps) {
  return (
    <EmailLayout preview="Confirm your email address to finish setting up your JARVIS account">
      <Section className="px-2">
        <Heading as="h2" className="text-2xl font-bold">
          Confirm your email address
        </Heading>

        <Section className="mb-6">
          <Text className="mb-2 text-base">
            Hi <span className="font-bold">{userName}</span>,
          </Text>
          <Text className="mt-0 text-base">
            Welcome to <span className="font-bold">JARVIS</span>! Before we get
            started, please confirm your email address to activate your account
            and keep your information secure.
          </Text>
        </Section>

        <Section className="mb-6 text-center">
          <EmailButton href={verificationUrl}>Confirm my email</EmailButton>
        </Section>

        <SecurityNotice expiresIn={expiresIn} />

        <Text className="text-muted-foreground mb-4 text-base">
          Having trouble with the button?{" "}
          <Link href={verificationUrl} className="underline">
            Click here
          </Link>{" "}
          to verify your email.
        </Text>

        <Hr className="my-6 border" />

        <RequestInfo
          requestedFrom={requestedFrom}
          requestedAt={requestedAt}
        />
      </Section>
    </EmailLayout>
  );
}