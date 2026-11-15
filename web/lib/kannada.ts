import type { Crop, DistrictClimate, DistrictPlan } from "./types";

// Kannada strings for the adaptation plan. The action lines are generated from the
// same plan numbers as the English ones; they are a summary, not a translation.

export const KN_CROP: Record<Crop, string> = {
  paddy: "ಭತ್ತ",
  ragi: "ರಾಗಿ",
  maize: "ಮೆಕ್ಕೆಜೋಳ",
};

const KN_CROP_GENITIVE: Record<Crop, string> = {
  paddy: "ಭತ್ತದ",
  ragi: "ರಾಗಿಯ",
  maize: "ಮೆಕ್ಕೆಜೋಳದ",
};

export const KN = {
  heading: "ಹೊಂದಾಣಿಕೆ ಯೋಜನೆ",
  bestNow: "ಇಂದಿನ ಉತ್ತಮ ಬೆಳೆ",
  best2050: "2050ರ ಉತ್ತಮ ಬೆಳೆ",
  switchAdvised: "ಬೆಳೆ ಬದಲಾವಣೆ ಸೂಚಿಸಲಾಗಿದೆ",
  noSwitch: "ಬೆಳೆ ಬದಲಾವಣೆ ಬೇಡ",
};

export function kannadaActions(plan: DistrictPlan, climate: DistrictClimate): string[] {
  const out: string[] = [];
  out.push(
    plan.switch
      ? `${KN_CROP_GENITIVE[plan.best_now]} ಬದಲು ${KN_CROP[plan.best_2050]} ಬೆಳೆಯಿರಿ.`
      : `${KN_CROP[plan.best_2050]} ಬೆಳೆಯನ್ನು ಮುಂದುವರಿಸಿ.`,
  );
  const weeks = climate.onset_shift_weeks;
  if (Math.abs(weeks) >= 0.5)
    out.push(`ಬಿತ್ತನೆಯನ್ನು ${Math.abs(weeks).toFixed(1)} ವಾರ ${weeks > 0 ? "ತಡವಾಗಿ" : "ಮುಂಚಿತವಾಗಿ"} ಮಾಡಿ.`);
  const gap = plan.water_gap_mm[plan.best_2050] ?? 0;
  if (gap > 0) out.push(`${gap.toFixed(0)} ಮಿ.ಮೀ ಹೆಚ್ಚುವರಿ ನೀರಾವರಿಗೆ ಯೋಜನೆ ಮಾಡಿ.`);
  return out;
}
