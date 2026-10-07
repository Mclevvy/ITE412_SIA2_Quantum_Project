import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { clearDeviceTokens } from "../lib/pushNotifications";
import { Button } from "./ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
import Logo from "./Logo";
import {
  PIN_LENGTH,
  MAX_PIN_ATTEMPTS,
  MAX_SESSION_DAYS,
  hasPinFor,
  markPinSkippedFor,
  setPinFor,
  verifyPinFor,
  clearPin,
} from "../lib/pinLock";

function PinShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#2A0A12] via-[#4A0E1E] to-black" />
      <div className="relative z-10 flex items-center justify-center min-h-screen p-6">
        <div className="w-full max-w-xs text-center">
          <Logo size="xl" className="mx-auto mb-4" />
          <h1 className="text-white text-xl font-bold">{title}</h1>
          <p className="text-white/80 text-sm mt-1 mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function PinEntry({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-center">
      <InputOTP
        maxLength={PIN_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(v.replace(/\D/g, "").slice(0, PIN_LENGTH))}
      >
        <InputOTPGroup>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <InputOTPSlot key={i} index={i} className="bg-white/10 border-white/20 text-white" />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

/** First-run: create a 6-digit PIN (or skip). Shown once per account. */
export function PinSetup({ uid, onDone }: { uid: string; onDone: (created: boolean) => void }) {
  const [step, setStep] = useState<"create" | "confirm">("create");
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step === "create" && pin.length === PIN_LENGTH) {
      setErr(null);
      setStep("confirm");
    }
  }, [pin, step]);

  useEffect(() => {
    if (step !== "confirm" || confirm.length !== PIN_LENGTH || busy) return;
    if (confirm !== pin) {
      setErr("PINs don't match — try again.");
      setConfirm("");
      return;
    }
    setBusy(true);
    setPinFor(pin, uid)
      .then(() => onDone(true))
      .catch(() => {
        setErr("Couldn't save the PIN on this device.");
        setBusy(false);
      });
  }, [confirm, step, pin, busy, uid, onDone]);

  const handleSkip = () => {
    markPinSkippedFor(uid);
    onDone(false);
  };

  return (
    <PinShell
      title={step === "create" ? "Set an app PIN" : "Confirm your PIN"}
      subtitle={
        step === "create"
          ? `A ${PIN_LENGTH}-digit PIN unlocks this trusted device for up to ${MAX_SESSION_DAYS} days.`
          : `Enter the same ${PIN_LENGTH} digits again.`
      }
    >
      <PinEntry value={step === "create" ? pin : confirm} onChange={step === "create" ? setPinValue : setConfirm} disabled={busy} />
      {err && <p role="alert" className="text-sm text-red-300 mt-4">{err}</p>}
      <div className="mt-6 space-y-3">
        {step === "confirm" && (
          <Button
            type="button"
            variant="outline"
            className="w-full bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white rounded-full"
            disabled={busy}
            onClick={() => {
              setStep("create");
              setPinValue("");
              setConfirm("");
              setErr(null);
            }}
          >
            Start over
          </Button>
        )}
        <button type="button" onClick={handleSkip} disabled={busy} className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 text-sm text-white/80 hover:text-white hover:underline disabled:opacity-50">
          Skip for now
        </button>
      </div>
    </PinShell>
  );
}

/** Per-launch gate: correct PIN continues into the trusted session. */
export function PinUnlock({ uid, onUnlock }: { uid: string; onUnlock: () => void }) {
  const navigate = useNavigate();
  const [pin, setPinValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);
  const attemptsLeft = MAX_PIN_ATTEMPTS - fails;

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    verifyPinFor(pin, uid).then((ok) => {
      if (ok) {
        onUnlock();
        return;
      }
      const nextFails = fails + 1;
      setFails(nextFails);
      setPinValue("");
      setBusy(false);
      if (nextFails >= MAX_PIN_ATTEMPTS) {
        // Too many guesses: drop the session and require the real password.
        // Awaiting the token clear first — it needs the live session (rules
        // require auth.uid === $uid) and would lose the race against signOut.
        clearDeviceTokens(uid).then(() => {
          void signOut(auth).finally(() => navigate("/", { replace: true }));
        });
      } else {
        setErr(`Wrong PIN. ${MAX_PIN_ATTEMPTS - nextFails} attempt(s) left.`);
      }
    });
  }, [pin, busy, fails, uid, onUnlock, navigate]);

  const usePasswordInstead = () => {
    // Rules require auth.uid === $uid on deviceTokens, so this must be written
    // while the session is still alive — awaited so the delete can't lose the
    // race against signOut.
    clearDeviceTokens(uid).then(() => {
      void signOut(auth).finally(() => navigate("/", { replace: true }));
    });
  };

  return (
    <PinShell title="Enter app PIN" subtitle="Unlock this trusted device.">
      <PinEntry value={pin} onChange={(v) => { setPinValue(v); setErr(null); }} disabled={busy} />
      {err && <p role="alert" className="text-sm text-red-300 mt-4">{err}</p>}
      {attemptsLeft < MAX_PIN_ATTEMPTS && attemptsLeft > 0 && (
        <p aria-live="polite" className="text-xs text-white/80 mt-2">{attemptsLeft} attempt(s) left before sign-out.</p>
      )}
      <button type="button" onClick={usePasswordInstead} className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 text-sm text-white/80 hover:text-white hover:underline mt-6">
        Use password instead
      </button>
    </PinShell>
  );
}

/** Change / remove the PIN from inside the app. Falls back to create flow. */
export function PinManage({ uid, onDone }: { uid: string; onDone: () => void }) {
  const [step, setStep] = useState<"verify" | "create" | "confirm">("verify");
  const [oldPin, setOldPin] = useState("");
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // No PIN on record for this account: go straight to create.
    if (!hasPinFor(uid)) setStep("create");
  }, [uid]);

  useEffect(() => {
    if (step !== "verify" || oldPin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    verifyPinFor(oldPin, uid).then((ok) => {
      setBusy(false);
      if (ok) {
        setErr(null);
        setStep("create");
      } else {
        setErr("Wrong current PIN.");
        setOldPin("");
      }
    });
  }, [oldPin, step, busy, uid]);

  useEffect(() => {
    if (step === "create" && pin.length === PIN_LENGTH) {
      setErr(null);
      setStep("confirm");
    }
  }, [pin, step]);

  useEffect(() => {
    if (step !== "confirm" || confirm.length !== PIN_LENGTH || busy) return;
    if (confirm !== pin) {
      setErr("PINs don't match — try again.");
      setConfirm("");
      return;
    }
    setBusy(true);
    setPinFor(pin, uid)
      .then(() => onDone())
      .catch(() => {
        setErr("Couldn't save the PIN on this device.");
        setBusy(false);
      });
  }, [confirm, step, pin, busy, uid, onDone]);

  const handleRemove = () => {
    clearPin();
    markPinSkippedFor(uid);
    onDone();
  };

  return (
    <PinShell
      title="App PIN"
      subtitle={
        step === "verify"
          ? "Enter your current PIN first."
          : step === "create"
            ? `Enter a new ${PIN_LENGTH}-digit PIN.`
            : "Confirm the new PIN."
      }
    >
      {step === "verify" && hasPinFor(uid) && (
        <PinEntry value={oldPin} onChange={(v) => { setOldPin(v); setErr(null); }} disabled={busy} />
      )}
      {step === "create" && (
        <PinEntry value={pin} onChange={setPinValue} disabled={busy} />
      )}
      {step === "confirm" && (
        <PinEntry value={confirm} onChange={setConfirm} disabled={busy} />
      )}
      {err && <p role="alert" className="text-sm text-red-300 mt-4">{err}</p>}
      <div className="mt-6 space-y-3">
        {step !== "verify" && hasPinFor(uid) && (
          <Button
            type="button"
            variant="outline"
            className="w-full bg-transparent text-red-200 border-red-300/40 hover:bg-red-500/20 hover:text-red-100 rounded-full"
            disabled={busy}
            onClick={handleRemove}
          >
            Remove PIN instead
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white rounded-full"
          disabled={busy}
          onClick={onDone}
        >
          {hasPinFor(uid) ? "Cancel" : "Done"}
        </Button>
      </div>
    </PinShell>
  );
}
