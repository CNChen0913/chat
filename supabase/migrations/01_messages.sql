-- 01_messages.sql
-- 訊息資料表、安全規則(RLS)、防洗版、即時通知、舊訊息清理。
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行(不會重複建立)。

-- ---------------------------------------------------------------
-- 1. 資料表
-- ---------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  -- 發送者的匿名編號。由伺服器填入 auth.uid(),前端無法冒充別人
  user_id    uuid not null default auth.uid(),
  nickname   text not null,
  body       text,
  file_path  text,
  file_name  text,
  file_type  text,
  file_size  bigint,
  -- 以伺服器時間為準
  created_at timestamptz not null default now(),

  constraint messages_nickname_len check (char_length(nickname) between 1 and 30),
  constraint messages_body_len check (body is null or char_length(body) between 1 and 500),
  -- 文字和檔案至少要有一個
  constraint messages_has_content check (body is not null or file_path is not null),
  -- 檔案欄位要一起出現
  constraint messages_file_fields check (
    (file_path is null and file_name is null and file_type is null and file_size is null)
    or (file_path is not null and file_name is not null and file_type is not null and file_size is not null)
  ),
  constraint messages_file_size check (file_size is null or file_size between 0 and 5242880),
  constraint messages_file_name_len check (file_name is null or char_length(file_name) between 1 and 255),
  constraint messages_file_type_len check (file_type is null or char_length(file_type) <= 100),
  -- 檔案路徑必須是「小時資料夾/自己的編號-隨機碼.副檔名」,不能指到別人的檔案
  constraint messages_file_path_shape check (
    file_path is null
    or file_path ~ ('^[0-9]{10}/' || user_id::text || '-[0-9a-f-]{36}\.[a-z0-9]{1,10}$')
  ),
  -- 擋掉可執行檔(與前端的清單相同)
  constraint messages_file_name_not_executable check (
    file_name is null
    or lower(file_name) !~ '\.(exe|bat|cmd|com|msi|scr|sh|ps1|vbs|js|jar|apk|app|dll|lnk|reg|wsf|hta|cpl|pif|gadget)$'
  )
);

create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);

-- ---------------------------------------------------------------
-- 2. 安全規則:只有匿名登入者能讀與新增;沒有任何人能改或刪
-- ---------------------------------------------------------------
alter table public.messages enable row level security;

drop policy if exists "signed-in users can read messages" on public.messages;
create policy "signed-in users can read messages"
  on public.messages for select
  to authenticated
  using (true);

drop policy if exists "signed-in users can send their own messages" on public.messages;
create policy "signed-in users can send their own messages"
  on public.messages for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;

-- ---------------------------------------------------------------
-- 3. 防洗版:同一個編號 3 秒內只能送一則
-- ---------------------------------------------------------------
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.user_id := auth.uid();
  new.nickname := btrim(new.nickname);
  new.created_at := now();

  -- 同一個人同時送出兩則時,讓它們排隊檢查
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  if exists (
    select 1 from public.messages
    where user_id = new.user_id
      and created_at > now() - interval '3 seconds'
  ) then
    raise exception 'RATE_LIMITED';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- ---------------------------------------------------------------
-- 4. 即時通知:新訊息會推給所有訂閱的人
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 5. 舊訊息清理:只保留最新 200 則,每小時整理一次
-- ---------------------------------------------------------------
create or replace function public.trim_messages()
returns void
language sql
as $$
  delete from public.messages
  where id not in (
    select id from public.messages order by created_at desc limit 200
  );
$$;

-- 只有排程能執行,網頁上的使用者不行
revoke execute on function public.trim_messages() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule('trim-messages', '5 * * * *', $$select public.trim_messages()$$);
