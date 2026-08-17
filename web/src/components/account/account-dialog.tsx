import { AccountEmailSection } from "~/components/account/account-email-section";
import { AccountMcpSection } from "~/components/account/account-mcp-section";
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
      {/*
        The scroll lives on the inner pane, not on DialogContent. DialogContent carries
        `bp-notch`/`bp-ticks`, whose drawn outline and corner ticks are `absolute; inset: 0`
        pseudo-elements — inside a scroll container those scroll away with the content, so a
        tall tab used to drag the dialog's own frame up out of place.
      */}
      <DialogContent className="flex h-full max-h-[40rem] flex-col sm:max-w-[calc(100%-2rem)] md:max-w-2xl lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Account details</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="account" className="mt-2 flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto">
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
            <TabsContent value="mcp">
              <AccountMcpSection />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
