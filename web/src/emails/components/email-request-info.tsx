import { Text } from "@react-email/components";

interface RequestInfoProps {
  requestedFrom: string;
  requestedAt: string;
}

export default function RequestInfo({ requestedFrom, requestedAt }: RequestInfoProps) {
  return (
    <>
      <Text className="mb-1 text-base font-bold">Didn’t request this?</Text>
      <Text className="mt-0 text-base">
        A verification request was made from{" "}
        <span className="font-bold">{requestedFrom}</span> at{" "}
        <span className="font-bold">{requestedAt}</span>. If this wasn&apos;t you,
        you can safely ignore this email — your account will remain inactive
        until verified.
      </Text>
    </>
  );
}