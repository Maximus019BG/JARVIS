import { AccountEmailSection } from "~/components/account/account-email-section";
import { AccountPasswordSection } from "~/components/account/account-password-section";
import { AccountProfileSection } from "~/components/account/account-profile-section";
import { AccountTwoFactorSection } from "~/components/account/account-two-factor-section";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Separator } from "~/components/ui/separator";

export function AccountDialog({
  ...props
}: React.ComponentProps<typeof Dialog>) {
  return (
    <Dialog {...props}>
      <DialogContent className="flex h-full max-h-[40rem] flex-col overflow-auto sm:max-w-[calc(100%-2rem)] md:max-w-2xl lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Account details</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="account" className="mt-2">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>
          <TabsContent value="account">
            <div className="flex flex-col gap-4">
              <AccountProfileSection />
              <Separator />
              <AccountEmailSection />
              <Separator />
              <AccountPasswordSection />
            </div>
          </TabsContent>
          <TabsContent value="security">
            <AccountTwoFactorSection />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
