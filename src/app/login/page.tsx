import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Creator Outreach</CardTitle>
          <CardDescription>Sign in to your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={signIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} autoComplete="current-password" />
            </div>
            <div className="flex gap-2">
              <SubmitButton name="mode" value="signin" className="flex-1">
                Sign in
              </SubmitButton>
              <SubmitButton name="mode" value="signup" variant="outline" className="flex-1">
                Create account
              </SubmitButton>
            </div>
            <Link href="/forgot-password" className="block text-center text-sm text-muted-foreground underline">
              Forgot password?
            </Link>
          </ActionForm>
        </CardContent>
      </Card>
    </main>
  );
}
