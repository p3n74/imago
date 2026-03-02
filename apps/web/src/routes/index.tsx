import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Shield,
  Zap,
  Github,
  CheckCircle2,
  Users,
  Loader2,
  Image,
  LogIn,
} from "lucide-react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { authClient } from "@/lib/auth-client";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: session, isPending, error: authError } = authClient.useSession();
  const roleQuery = useQuery({
    ...trpc.team.getMyRole.queryOptions(),
    enabled: !!session,
    retry: false,
  });
  
  const isWhitelisted = (roleQuery.data?.role ?? null) !== null;

  // If there's an error connecting to the auth service, assume signed out for the landing page
  if (authError) {
    return <SignedOutHome />;
  }

  if (isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="animate-spin size-4" />
          Loading...
        </div>
      </div>
    );
  }

  // Signed in but not whitelisted: show forbidden
  if (session && roleQuery.isSuccess && !isWhitelisted) {
    return <NotWhitelistedView />;
  }

  // Handle case where session exists but role query failed
  if (session && roleQuery.isError) {
    return <SignedInHome error={roleQuery.error?.message} />;
  }

  // Show home view if signed in
  if (session) {
    return <SignedInHome />;
  }

  return <SignedOutHome />;
}

function SignedInHome({ error }: { error?: string }) {
  const { data: session } = authClient.useSession();
  const roleQuery = useQuery(trpc.team.getMyRole.queryOptions());

  return (
    <div className="mx-auto max-w-6xl min-w-0 px-3 py-6 sm:px-4 sm:py-8 text-center">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Overview</p>
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          Welcome back, {session?.user.name?.split(" ")[0] ?? "User"}
        </h1>
        {error ? (
          <p className="text-destructive max-w-2xl mx-auto">
            Failed to load permissions: {error}. Please ensure the server is running.
          </p>
        ) : (
          <p className="text-muted-foreground max-w-2xl mx-auto">
            You are currently signed in as <span className="text-foreground font-medium">{session?.user.email}</span> 
            with the role <span className="text-primary font-semibold">{roleQuery.data?.role ?? "None"}</span>.
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-3 max-w-3xl mx-auto">
        <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => window.location.href = '/dashboard'}>
          <CardHeader>
            <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-2">
              <LayoutDashboard className="text-primary" />
            </div>
            <CardTitle>Dashboard</CardTitle>
            <CardDescription>View your workspace</CardDescription>
          </CardHeader>
        </Card>

        <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => window.location.href = '/photos'}>
          <CardHeader>
            <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-2">
              <Image className="text-primary" />
            </div>
            <CardTitle>Photos</CardTitle>
            <CardDescription>Browse and download your photos</CardDescription>
          </CardHeader>
        </Card>

        <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => window.location.href = '/team'}>
          <CardHeader>
            <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-2">
              <Users className="text-primary" />
            </div>
            <CardTitle>Team</CardTitle>
            <CardDescription>Manage users and permissions</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

function SignedOutHome() {
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <>
      <div className="h-screen overflow-y-auto snap-y snap-mandatory scroll-smooth">
        {/* Hero Slide */}
        <section className="min-h-screen w-full snap-start snap-always flex flex-col items-center justify-center px-4 py-12 sm:py-24 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-6 animate-fade-in">
              <Zap className="w-3 h-3 fill-current" />
              <span>Your memories, beautifully organized</span>
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
              <span className="text-primary">Imago</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              A Private Photogallery of the Citadel
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
              <Button
                size="lg"
                className="px-8 h-12 text-base font-semibold gap-2 whitespace-nowrap shrink-0"
                onClick={() => setSignInOpen(true)}
              >
                <LogIn className="w-5 h-5 shrink-0" />
                Sign In
              </Button>
              <Button size="lg" variant="outline" asChild className="px-8 h-12 text-base font-semibold gap-2 whitespace-nowrap shrink-0">
                <a href="https://github.com/p3n74/imago">
                  <Github className="w-5 h-5" />
                  View Source
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* Features Slide */}
        <section className="min-h-screen w-full snap-start snap-always flex flex-col items-center justify-center py-20 bg-muted/30">
          <div className="max-w-6xl mx-auto px-4 w-full">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Built for the way you share</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Invite who you trust. Keep your photos yours.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <FeatureCard 
                icon={<Shield className="w-6 h-6 text-primary" />}
                title="Secure Auth"
                description="Whitelist-only access. Only people you add can see your gallery."
              />
              <FeatureCard 
                icon={<Image className="w-6 h-6 text-primary" />}
                title="Compressed Previews"
                description="Quick browsing with WebP. Download originals when you need the full file."
              />
              <FeatureCard 
                icon={<CheckCircle2 className="w-6 h-6 text-primary" />}
                title="Team Management"
                description="Add or remove users from the Team page. You control who gets in."
              />
            </div>
          </div>
        </section>
      </div>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Sign In</DialogTitle>
            <DialogDescription>
              Access your account via Google
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <LoginCard onSuccess={() => setSignInOpen(false)} />
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <Card className="bg-background border-none shadow-none text-center">
      <CardHeader>
        <div className="mx-auto mb-4 bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center">
          {icon}
        </div>
        <CardTitle className="text-xl mb-2">{title}</CardTitle>
        <CardDescription className="text-base">{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function LoginCard({ onSuccess }: { onSuccess?: () => void }) {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    const callbackURL = typeof window === "undefined" ? "/" : `${window.location.origin}/`;
    setIsGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      onSuccess?.();
    } catch (error) {
      toast.error("Google sign in failed. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button
        type="button"
        className="w-full h-12 text-base"
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
      >
        {isGoogleLoading ? "Connecting..." : "Continue with Google"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        By signing in, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
