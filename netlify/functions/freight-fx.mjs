// GET /api/freight/fx  -> latest Bank of Canada USD/CAD daily rate
// Fetched server-side so the browser never needs a cross-site request.
import { HttpError, json, requireSession, route } from "../lib/http.mjs";

const VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1";

export default route(async (req) => {
  await requireSession(req);
  let data;
  try {
    const res = await fetch(VALET_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    data = await res.json();
  } catch {
    throw new HttpError(502, "The Bank of Canada rate is unavailable right now. Enter the rate by hand.");
  }
  const obs = data?.observations?.[0];
  const rate = Number(obs?.FXUSDCAD?.v);
  if (!obs?.d || !(rate > 0)) {
    throw new HttpError(502, "The Bank of Canada returned an unexpected answer. Enter the rate by hand.");
  }
  return json({ usdcad: rate, date: obs.d, source: "Bank of Canada daily average" });
});

export const config = { path: "/api/freight/fx", method: "GET" };
