import { Button } from "../ui/button";
import { FlaskConicalIcon } from "lucide-react";
import { getBrixToAbvFactor } from "../../lib/abvModel";

interface AbvHeroProps {
  estimatedAbv: { value: number; basis: "measured" | "soft" | "estimated" } | null;
  ogBrixForCheck: number | null;
  brixAboveOg: boolean;
  updatedAt: number | null;
  isBatchActive: boolean;
  lastHydroCheck: any;
  onLogCheck: () => void;
}

/** Dark wine Alcohol % hero card with the hydrometer-check strip (moved verbatim out of Dashboard.tsx). */
export function AbvHero({
  estimatedAbv,
  ogBrixForCheck,
  brixAboveOg,
  updatedAt,
  isBatchActive,
  lastHydroCheck,
  onLogCheck,
}: AbvHeroProps) {
  // Latest hydrometer-check verdict. Actual checks should match the app now
  // (|Δ| ≤ 1). A potential check (what OG becomes fully dry) exceeds the live
  // app value by exactly the alcohol still locked in residual sugar, so the
  // expected gap is current × factor — that gap converging to ~0 at dryness
  // is the validation signal, not an error.
  const hydroMeter =
    lastHydroCheck !== null && typeof lastHydroCheck.hydrometerAbv === "number"
      ? Number(lastHydroCheck.hydrometerAbv) : null;
  const hydroModel =
    lastHydroCheck !== null && typeof lastHydroCheck.modelAbv === "number"
      ? Number(lastHydroCheck.modelAbv) : null;
  const hydroDelta = hydroMeter !== null && hydroModel !== null ? hydroMeter - hydroModel : null;
  const hydroType = lastHydroCheck !== null && lastHydroCheck.checkType === "potential" ? "potential" : "actual";
  const hydroCheckCur =
    lastHydroCheck !== null && typeof lastHydroCheck.currentBrix === "number" ? Number(lastHydroCheck.currentBrix) : null;
  const hydroFactor =
    lastHydroCheck !== null && typeof lastHydroCheck.factor === "number" && lastHydroCheck.factor > 0
      ? Number(lastHydroCheck.factor) : getBrixToAbvFactor();
  const hydroExpectedGap =
    hydroCheckCur !== null ? Math.max(0, hydroCheckCur * hydroFactor) : null;
  const hydroVerdict: "agree" | "consistent" | "check" | null =
    hydroDelta === null ? null
    : hydroType === "actual"
      ? (Math.abs(hydroDelta) <= 1 ? "agree" : "check")
      : (hydroExpectedGap !== null && Math.abs(hydroDelta - hydroExpectedGap) <= 1.5 ? "consistent" : "check");
  // A check row is a frozen snapshot of the moment it was logged — never a
  // live number. Dating it makes stale comparisons obvious at a glance.
  const hydroCheckedAt =
    lastHydroCheck !== null && typeof lastHydroCheck.checkedAt === "number"
      ? new Date(Number(lastHydroCheck.checkedAt)).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#23060F] via-[#4A0E1E] to-[#8B1538] p-5 shadow-xl shadow-[#8B1538]/25 ring-1 ring-white/10 text-[#FDF8F1]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">Alcohol Content</p>
          <p className="font-extrabold tracking-tight mt-2 text-[2.75rem] leading-none tnum">
            {estimatedAbv !== null ? (
              <>{estimatedAbv.value.toFixed(1)}<span className="font-medium text-white/60 text-lg ml-1">% ABV</span></>
            ) : (
              <span className="text-white/40">--</span>
            )}
          </p>
          <p className="text-xs text-white/80 mt-2">
            {estimatedAbv?.basis === 'measured'
              ? `From sugar drop (OG ${ogBrixForCheck?.toFixed(1)} − current)${updatedAt ? ` · logged ${new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
              : estimatedAbv?.basis === 'soft'
                ? `From sugar drop (soft-sensor estimate) · OG ${ogBrixForCheck?.toFixed(1)}`
                : 'From current pH, temperature & pressure (experimental)'}
          </p>
          {brixAboveOg && (
            <p className="text-xs text-amber-200 bg-white/10 ring-1 ring-white/15 rounded-xl p-2 mt-2">
              Current Brix is above starting Brix, so the chemistry estimate is skipped. Check the readings: starting Brix must be the Day-0 must (not the finish target), and use a hydrometer — refractometers read high once alcohol is present.
            </p>
          )}
        </div>
        <div className="w-12 h-12 shrink-0 rounded-2xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
          <FlaskConicalIcon className="w-6 h-6 text-amber-200" />
        </div>
      </div>

      {/* Hydrometer check strip */}
      {isBatchActive && (
        <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">Hydrometer check</p>
            {hydroMeter !== null ? (
              <p className="text-xs text-white/75 mt-1">
                Meter {hydroMeter.toFixed(1)}%{hydroType === "potential" ? " (potential)" : ""}
                {" "}vs app{" "}
                {hydroModel !== null && hydroDelta !== null
                  ? `${hydroModel.toFixed(1)}% (Δ ${hydroDelta >= 0 ? "+" : ""}${hydroDelta.toFixed(1)})`
                  : "—"}
                {" · "}
                {hydroVerdict === "agree" && (
                  <span className="text-emerald-300 font-semibold">agree ✓</span>
                )}
                {hydroVerdict === "consistent" && (
                  <span className="text-emerald-300 font-semibold">consistent ✓</span>
                )}
              {hydroVerdict === "check" && (
                <span className="text-amber-300 font-semibold">check readings</span>
              )}
              {hydroCheckedAt !== null && (
                <span className="text-white/40"> · {hydroCheckedAt}</span>
              )}
              </p>
            ) : (
              <p className="text-xs text-white/40 mt-1">No check logged yet.</p>
            )}
          </div>
          <Button size="sm" variant="outline" className="bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white rounded-full shrink-0" onClick={onLogCheck}>
            Log check
          </Button>
        </div>
      )}
    </div>
  );
}
