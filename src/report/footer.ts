/**
 * Validation instruments. These links are how the probe measures the *business*
 * thesis, not vanity metrics — so they are shown only when there's a finding.
 *
 * TODO(week 3): point these at hosted signal pages once they exist:
 *   - FEEDBACK_URL  -> https://toolprint.dev/r/<event_id>  ("real issue or false positive?")
 *   - TEAMS_URL     -> https://toolprint.dev/teams         (continuous-monitoring fake-door)
 * Until then they point at the repo so we never ship a dead link.
 */
export const FEEDBACK_URL = "https://github.com/jestatsio/toolprint/issues/new?labels=feedback";
export const TEAMS_URL = "https://github.com/jestatsio/toolprint#continuous-monitoring";
