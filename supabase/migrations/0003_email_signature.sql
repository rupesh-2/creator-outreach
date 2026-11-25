-- Signature appended to every outgoing email (e.g. name + portfolio link). Not used for DMs.
alter table settings add column email_signature text not null default '';
