-- Exceptional vacation reprogramming with private evidence and linked history.

alter table public.aircontrol_vacations
  add column if not exists deleted_at timestamptz,
  add column if not exists reprogrammed_from_id uuid references public.aircontrol_vacations(id),
  add column if not exists reprogrammed_to_id uuid references public.aircontrol_vacations(id),
  add column if not exists reprogram_reason text,
  add column if not exists exception_authorizer text,
  add column if not exists exception_evidence_path text,
  add column if not exists formal_reprogram_confirmed boolean not null default false,
  add column if not exists is_exception_black boolean not null default false,
  add column if not exists exception_black_days numeric(8,2) not null default 0;

create unique index if not exists aircontrol_vacations_reprogrammed_from_unique
  on public.aircontrol_vacations(reprogrammed_from_id)
  where reprogrammed_from_id is not null and deleted_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aircontrol-vacation-evidence',
  'aircontrol-vacation-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
