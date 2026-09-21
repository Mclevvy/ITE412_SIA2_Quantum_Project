import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { Eye, EyeOff } from "lucide-react";

import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../lib/firebase"; 

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Added your working ImgBB direct link
  const logoUrl = "https://i.ibb.co/psTtv5x/logo.png";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLogin();
    } catch (error: any) {
      setErr(mapAuthError(error?.code));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setErr(null);
    setMsg(null);

    if (!email) {
      setErr("Ilagay muna ang email para ma-send ang reset link.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setMsg("Na-send na ang password reset link sa email mo.");
    } catch (error: any) {
      setErr(mapAuthError(error?.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1610968386377-46ef210bab6c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxiaWduYXklMjBmcnVpdCUyMHdpbmUlMjBiZXJyeXxlbnwxfHx8fDE3NjA2NjcyNDB8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Bignay fruit background"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/70 to-black/80" />
      </div>

      {/* Login Content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-6">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-4">
              <img
                src={logoUrl}
                alt="Project FERMA Logo"
                className="w-48 h-48 object-contain filter drop-shadow-2xl"
              />
            </div>
            <p className="text-purple-200 text-xl">Bunius-Sense</p>
          </div>

          {/* Login Card */}
          <Card className="bg-white/95 backdrop-blur-sm p-6 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>

                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10 h-11"
                    required
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="
                      absolute inset-y-0 right-2
                      flex items-center
                      text-gray-500
                      hover:text-gray-700
                    "
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {err && <p className="text-sm text-red-600">{err}</p>}
              {msg && <p className="text-sm text-green-700">{msg}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#8B1538] hover:bg-[#6B1028] text-white"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-4">
              Forgot password?{" "}
              <button
                type="button"
                onClick={handleReset}
                disabled={loading}
                className="text-[#8B1538] hover:underline"
              >
                Reset here
              </button>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function mapAuthError(code?: string) {
  switch (code) {
    case "auth/invalid-email":
      return "Invalid email format.";
    case "auth/user-not-found":
      return "Walang user na naka-register sa email na ‘yan.";
    case "auth/wrong-password":
      return "Maling password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try ulit later.";
    default:
      return "Login failed. Pakicheck ang credentials.";
  }
}