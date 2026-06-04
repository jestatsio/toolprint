/**
 * Validation instruments — shown only when there's a finding, so they measure
 * the *business* thesis (is the rug-pull/poisoning problem real to you, and do
 * you want this watching your whole fleet?) rather than vanity metrics.
 *
 * Both open a structured GitHub issue form: FEEDBACK_URL collects false-positive
 * and missed-detection reports (the precision signal); TEAMS_URL is the
 * fake-door that captures demand for the not-yet-built continuous-monitoring
 * product. The forms live in .github/ISSUE_TEMPLATE/.
 */
const ISSUE_NEW = "https://github.com/jestatsio/toolprint/issues/new?template=";
export const FEEDBACK_URL = `${ISSUE_NEW}false-positive.yml`;
export const TEAMS_URL = `${ISSUE_NEW}continuous-monitoring.yml`;
