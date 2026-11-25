-- Onboarding volunteers: vetted people who set organizations up, and the
-- organizations they take on. listing_url is a Digital Public Goods Registry
-- or For Good First Issue link, for open-source projects already vetted.
ALTER TABLE accounts ADD COLUMN onboarder_status TEXT;
ALTER TABLE applications ADD COLUMN onboarder_account_id TEXT;
ALTER TABLE applications ADD COLUMN onboarder_note TEXT;
ALTER TABLE applications ADD COLUMN listing_url TEXT;
