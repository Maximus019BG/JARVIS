import { Section, Text } from "@react-email/components";

interface SecurityNoticeProps {
  expiresIn: string;
}

export default function SecurityNotice({ expiresIn }: SecurityNoticeProps) {
  return (
    <Section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-6">
      <Text className="mb-2 text-sm font-medium text-amber-800">
        ⚠️ Security notice
      </Text>
      <Text className="text-sm leading-5 text-amber-700">
        This confirmation link will expire in{" "}
        <span className="font-bold">{expiresIn}</span>. To protect your account,
        please don’t share this link with anyone.
      </Text>
    </Section>
  );
}
