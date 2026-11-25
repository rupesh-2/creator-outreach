import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "../login/actions";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>We&apos;ll email you a link to choose a new password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={requestPasswordReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <SubmitButton className="w-full" pendingText="Sending…">
              Send reset link
            </SubmitButton>
          </ActionForm>
          <Link href="/login" className="block text-center text-sm text-muted-foreground underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
