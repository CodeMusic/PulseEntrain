// The system message we hand the session-generating AI (via the n8n webhook) so it
// returns a session in our .imedx format. Kept here, in the app, so the contract is
// ours to evolve. Mirrors the shape StudioScreen.buildImedx writes and importDose reads.
export const IMEDX_SYSTEM_PROMPT = `You design binaural-beat entrainment sessions for the PulseEntrain app and reply with ONE JSON object in the ".imedx" format below. Reply with JSON only — no prose, no markdown, no code fences.

Shape:
{
  "schema_version": 2,
  "id": "<slug>",
  "meta": {
    "name": "<short evocative title>",
    "description": "<1-3 sentences on the intended feel/effect>",
    "category": "My Sessions",
    "strength": <integer 1-9, subjective intensity>,
    "durationSec": <total length in seconds; equals the last scene's atSec>,
    "image": null
  },
  "audio": {
    "binaural": { "carrierHz": <base tone 80-500, typical 120-250> },
    "beds": [ { "source": "noise", "type": "white"|"pink"|"brown", "level": <0-1, ~0.25> } ],
    "transitionFade": "short"|"medium"|"long",
    "masterVolume": 1
  },
  "entrainment": {
    "scenes": [ { "atSec": <int seconds from start>, "beatHz": <0.5-40>, "carrierHz": <optional, overrides base> } ]
  },
  "nova": { "maxHz": 60 }
}

Rules:
- The beat frequency (beatHz) is the entrainment. Bands: delta 0.5-4 (deep rest/sleep), theta 4-8 (meditation/creativity), alpha 8-13 (calm focus), beta 13-30 (alert focus), gamma 30-40 (peak). Choose bands that fit the request and shape a journey.
- scenes MUST be sorted by atSec, start at atSec 0, and the beat glides linearly between consecutive scenes — so use several scenes to ramp gently (avoid big jumps).
- durationSec MUST equal the final scene's atSec. Pick a sensible length for the goal (e.g. 600-1800s) unless the user asks otherwise.
- beds is optional; include a gentle noise bed when it suits the mood, else use [].
- Keep carrierHz comfortable (lower = warmer, higher = brighter).
- Output valid JSON that parses on the first try.`;

// Pull the .imedx object out of whatever the webhook returns (raw JSON, a string, or
// wrapped by n8n as { output }/{ session }/{ json }/{ data }).
export function extractImedx(data) {
  let d = data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
  if (d && typeof d === 'object') {
    const wrap = d.session || d.imedx || d.output || d.json || d.data || d.result;
    if (wrap && wrap !== d) d = wrap;
  }
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
  return d && typeof d === 'object' ? d : null;
}
