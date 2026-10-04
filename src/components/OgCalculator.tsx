import { useMemo, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  estimateOgFromRecipe,
  FRUIT_BRIX_DEFAULT,
  SUGAR_PURITY_DEFAULT,
} from "../lib/abvModel";

interface OgCalculatorProps {
  onApply: (og: number) => void;
  defaultSugarKg?: string;
  defaultFruitKg?: string;
  defaultWaterL?: string;
}

/**
 * Recipe → OG calculator for chaptalized fruit wine. Mass-balance estimate
 * (added sugar at muscovado purity + fruit sugar over total must mass) so the
 * operator gets a trustworthy Starting Brix even when the Day-0 sample was
 * unmixed or unreadable. Prefilled with the house recipe (2kg sugar / 3kg
 * bignay / 3L water ≈ 30 Brix).
 */
export default function OgCalculator({
  onApply,
  defaultSugarKg = "2",
  defaultFruitKg = "3",
  defaultWaterL = "3",
}: OgCalculatorProps) {
  const [sugarKg, setSugarKg] = useState(defaultSugarKg);
  const [fruitKg, setFruitKg] = useState(defaultFruitKg);
  const [waterL, setWaterL] = useState(defaultWaterL);

  const estimate = useMemo(
    () =>
      estimateOgFromRecipe(
        sugarKg === "" ? null : Number(sugarKg),
        fruitKg === "" ? null : Number(fruitKg),
        waterL === "" ? null : Number(waterL)
      ),
    [sugarKg, fruitKg, waterL]
  );

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-700">Or calculate OG from recipe</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[11px] text-gray-500">Sugar (kg)</span>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={sugarKg}
            onChange={(e) => setSugarKg(e.target.value)}
            className="bg-white mt-0.5"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-500">Fruit (kg)</span>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={fruitKg}
            onChange={(e) => setFruitKg(e.target.value)}
            className="bg-white mt-0.5"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-gray-500">Water (L)</span>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={waterL}
            onChange={(e) => setWaterL(e.target.value)}
            className="bg-white mt-0.5"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          {estimate !== null ? (
            <>Estimated OG: <strong className="text-gray-900">{estimate.toFixed(1)} Brix</strong></>
          ) : (
            "Enter all three amounts."
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-white shrink-0"
          disabled={estimate === null}
          onClick={() => estimate !== null && onApply(estimate)}
        >
          Use this OG
        </Button>
      </div>
      <p className="text-[11px] text-gray-400">
        Assumes muscovado ≈ {Math.round(SUGAR_PURITY_DEFAULT * 100)}% sugar, bignay fruit ≈ {FRUIT_BRIX_DEFAULT} °Bx.
      </p>
    </div>
  );
}
