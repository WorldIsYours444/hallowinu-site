-- Fair play: only human play counts. Updates the public rules of the running/upcoming seasons.
UPDATE seasons SET rules_json = json_set(COALESCE(rules_json, '{}'), '$.summary', 'Top 10 season points (Arcade + The Haunt + Escape The Trenches) share the verified prize pool. Only human play counts: points from bots, scripts or any other non-human-driven system do not count and can lead to disqualification. No purchase necessary. Points have no cash value.')
 WHERE status IN ('UPCOMING','ACTIVE');
INSERT INTO audit_log (actor, action, target, details_json, created_at) VALUES
  ('migration', 'season.rules', NULL, '{"rule":"only human play counts; bots/automation do not count and can be disqualified","why":"0007"}', 1791936000000);
