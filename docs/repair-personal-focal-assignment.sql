-- Canonicalize invalid or missing focal references before FK validation.
-- Called transactionally by repair_focal.py. Does not remove or disable any FK.
create or replace function public.aircontrol_focal_name_key(value text)
returns text language sql immutable strict
set search_path = pg_catalog, public
as $$
  select trim(both '_' from regexp_replace(
    translate(lower(case when position(',' in value) > 0
      then split_part(value, ',', 2) || ' ' || split_part(value, ',', 1)
      else value end), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', '_', 'g'));
$$;

create or replace function public.aircontrol_default_focal_id()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare selected_id uuid;
begin
  if exists (select 1 from public.aircontrol_column_config
      where excel_header = '__aircontrol_default_focal__') then
    select u.id into selected_id
    from public.aircontrol_column_config c
    join public.aircontrol_users u on u.id::text = c.display_name
    where c.excel_header = '__aircontrol_default_focal__'
      and u.active and coalesce(to_jsonb(u)->>'deleted_at', '') = '';
  else
    select u.id into selected_id from public.aircontrol_users u
    where public.aircontrol_focal_name_key(u.name) = 'rosa_hernandez'
      and u.role = 'supervisor' and u.active
      and coalesce(to_jsonb(u)->>'deleted_at', '') = ''
    order by u.created_at, u.id limit 1;
  end if;
  return selected_id;
end;
$$;

create or replace function public.aircontrol_resolve_personal_focal()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare focal_name text; resolved_id uuid;
begin
  -- Preserve real assignments. The FK remains the final integrity check.
  if new.focal_user_id is not null and exists (
    select 1 from public.aircontrol_users u where u.id = new.focal_user_id
  ) then return new; end if;

  select field.value into focal_name
  from jsonb_each_text(case when jsonb_typeof(new.excel_fields) = 'object'
    then new.excel_fields else '{}'::jsonb end) field
  where public.aircontrol_focal_name_key(field.key) in ('focal', 'focal_asignado')
    and trim(coalesce(field.value, '')) <> ''
  order by case when field.key = 'FOCAL' then 0 else 1 end, field.key limit 1;

  if focal_name is not null then
    select u.id into resolved_id from public.aircontrol_users u
    where public.aircontrol_focal_name_key(u.name) = public.aircontrol_focal_name_key(focal_name)
      and u.active and coalesce(to_jsonb(u)->>'deleted_at', '') = ''
    order by case u.role when 'admin' then 3 when 'supervisor' then 2 else 1 end desc,
      u.created_at, u.id limit 1;
  end if;
  new.focal_user_id := coalesce(resolved_id, public.aircontrol_default_focal_id());
  if new.focal_user_id is null then
    raise exception 'Selecciona un usuario activo en Usuarios > Recibe personal sin focal antes de cargar personal.'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.aircontrol_focal_name_key(text) from public, anon, authenticated;
revoke all on function public.aircontrol_default_focal_id() from public, anon, authenticated;
revoke all on function public.aircontrol_resolve_personal_focal() from public, anon, authenticated;

drop trigger if exists aircontrol_personal_resolve_focal on public.aircontrol_personal;
create trigger aircontrol_personal_resolve_focal
before insert or update of focal_user_id, excel_fields on public.aircontrol_personal
for each row execute function public.aircontrol_resolve_personal_focal();
