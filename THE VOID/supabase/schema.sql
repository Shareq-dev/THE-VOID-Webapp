create extension if not exists pgcrypto;

create table if not exists public.users (
  creator_id text primary key default gen_random_uuid()::text,
  creator_name text not null,
  auth_type text not null default 'password',
  email text,
  password_hash text,
  password_salt text,
  signup_ip_hash text,
  browser_key_hash text,
  profile_pic_path text,
  profile_pic_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists auth_type text not null default 'password',
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists password_salt text,
  add column if not exists signup_ip_hash text,
  add column if not exists browser_key_hash text,
  add column if not exists profile_pic_path text,
  add column if not exists profile_pic_url text,
  add column if not exists last_login_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.users
  alter column auth_type set default 'password';

alter table public.users
  drop constraint if exists users_auth_type_check;

alter table public.users
  add constraint users_auth_type_check check (auth_type in ('password', 'guest', 'google'));

alter table public.users
  add column if not exists creator_name_key text generated always as (lower(btrim(creator_name))) stored;

create unique index if not exists users_creator_name_key_unique
  on public.users (creator_name_key);

drop index if exists users_signup_ip_hash_unique;
drop index if exists users_browser_key_hash_unique;

create index if not exists users_signup_ip_hash_idx
  on public.users (signup_ip_hash)
  where signup_ip_hash is not null;

create index if not exists users_browser_key_hash_idx
  on public.users (browser_key_hash)
  where browser_key_hash is not null;

create table if not exists public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled wallpaper',
  creator text not null default 'The Void',
  creator_id text references public.users(creator_id) on delete set null,
  auth_type text not null default 'password',
  storage_path text not null,
  public_url text not null,
  mime text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.wallpapers
  add column if not exists creator_id text,
  add column if not exists auth_type text not null default 'password';

alter table public.wallpapers
  alter column auth_type set default 'password';

alter table public.wallpapers
  drop constraint if exists wallpapers_auth_type_check,
  drop constraint if exists wallpapers_status_check;

alter table public.wallpapers
  add constraint wallpapers_auth_type_check check (auth_type in ('password', 'guest', 'google')),
  add constraint wallpapers_status_check check (status in ('pending', 'approved', 'rejected'));

create index if not exists wallpapers_storage_path_idx
  on public.wallpapers (storage_path);

create index if not exists wallpapers_status_created_idx
  on public.wallpapers (status, created_at desc);

create index if not exists wallpapers_creator_created_idx
  on public.wallpapers (creator_id, created_at desc);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
as $$
begin
  if lower(btrim(old.creator_name)) is distinct from lower(btrim(new.creator_name)) then
    raise exception 'Username cannot be changed after signup.';
  end if;
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists prevent_users_username_change on public.users;
create trigger prevent_users_username_change
before update of creator_name on public.users
for each row execute function public.prevent_username_change();

drop trigger if exists set_wallpapers_updated_at on public.wallpapers;
create trigger set_wallpapers_updated_at
before update on public.wallpapers
for each row execute function public.set_updated_at();

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.wallpapers enable row level security;
alter table public.app_settings enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.wallpapers to service_role;
grant select, insert, update, delete on table public.app_settings to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wallpapers',
  'wallpapers',
  true,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-pics',
  'profile-pics',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read wallpapers bucket" on storage.objects;
create policy "Public read wallpapers bucket"
on storage.objects for select
to public
using (bucket_id = 'wallpapers');

drop policy if exists "Public read profile pics bucket" on storage.objects;
create policy "Public read profile pics bucket"
on storage.objects for select
to public
using (bucket_id = 'profile-pics');
