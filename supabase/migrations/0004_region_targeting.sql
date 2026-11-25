-- Region targeting: detected creator country/language, and which countries to auto-analyse/draft.
alter table creators
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column country_evidence text,
  add column language text check (language in ('en', 'other'));
create index creators_owner_country on creators (owner_id, country);

alter table settings add column target_countries text[] not null default '{}';
