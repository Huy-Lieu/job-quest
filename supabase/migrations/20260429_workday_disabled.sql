-- Migration: add workday_disabled to search_configs
-- Replaces career_page_urls (per-config custom Workday URLs) which is removed
-- in favour of the global KNOWN_WORKDAY registry in lib/apify/ats-resolver.ts.
--
-- workday_disabled: tenant names (keys in KNOWN_WORKDAY) toggled OFF for this config.
-- Empty array = use all tenants matched from target_companies. Opt-out model.

ALTER TABLE search_configs
  ADD COLUMN IF NOT EXISTS workday_disabled text[] NOT NULL DEFAULT '{}';

-- career_page_urls is no longer used by the application.
-- Leave the column in place for now to avoid data loss on existing rows;
-- drop it manually once you've confirmed no data migration is needed:
--   ALTER TABLE search_configs DROP COLUMN IF EXISTS career_page_urls;
