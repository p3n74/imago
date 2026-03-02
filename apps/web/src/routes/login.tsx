import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Github, Image, Loader2, LogIn, Shield, Zap } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data) {
      throw redirect({ to: "/photos" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const handleGoogleSignIn = async () => {
    const callbackURL =
      typeof window === "undefined" ? "/photos" : `${window.location.origin}/photos`;

    setIsGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
    } catch {
      toast.error("Google sign in failed. Please try again.");
      setIsGoogleLoading(false);
    }
  };

  return (
    <>
      <div className="h-screen overflow-y-auto snap-y snap-mandatory scroll-smooth">
        <section className="min-h-screen w-full snap-start snap-always flex flex-col items-center justify-center px-4 py-12 sm:py-24 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6">
              <Zap className="h-3 w-3 fill-current shrink-0" />
              <span>Your memories, beautifully organized</span>
            </div>
            <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              <span className="text-primary">Imago</span>
            </h1>
            <p className="mb-10 max-w-2xl mx-auto text-lg text-muted-foreground sm:text-xl">
              A Private Photogallery of the Citadel
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
              <Button
                size="lg"
                className="h-12 px-8 gap-2 whitespace-nowrap text-base font-semibold shrink-0"
                onClick={() => setSignInOpen(true)}
              >
                <LogIn className="h-5 w-5 shrink-0" />
                Sign In
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-8 gap-2 whitespace-nowrap text-base font-semibold shrink-0">
                <a href="https://github.com/p3n74/imago" className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                  <Github className="h-5 w-5 shrink-0" />
                  View Source
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="min-h-screen w-full snap-start snap-always flex flex-col items-center justify-center bg-muted/30 py-20">
          <div className="max-w-6xl w-full mx-auto px-4">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-bold">Built for the way you share</h2>
              <p className="mx-auto max-w-xl text-muted-foreground">
                Invite who you trust. Keep your photos yours.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <FeatureCard
                icon={<Shield className="h-6 w-6 text-primary" />}
                title="Secure Auth"
                description="Whitelist-only access. Only people you add can see your gallery."
              />
              <FeatureCard
                icon={<Image className="h-6 w-6 text-primary" />}
                title="Compressed Previews"
                description="Quick browsing with WebP. Download originals when you need full quality."
              />
              <FeatureCard
                icon={<CheckCircle2 className="h-6 w-6 text-primary" />}
                title="Team Management"
                description="Add or remove users from Team. You control who gets in."
              />
            </div>
          </div>
        </section>
      </div>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Sign In</DialogTitle>
            <DialogDescription>Access your account via Google</DialogDescription>
          </DialogHeader>
          <Card className="border-0 shadow-none">
            <CardContent className="space-y-4 p-0 pt-4">
              <Button
                type="button"
                className="h-12 w-full gap-2 whitespace-nowrap text-base"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
              >
                {isGoogleLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4 shrink-0" />
                    Continue with Google
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-none bg-background text-center shadow-none">
      <CardHeader>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <CardTitle className="mb-2 text-xl">{title}</CardTitle>
        <CardDescription className="text-base">{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
