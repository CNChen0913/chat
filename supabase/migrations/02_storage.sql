-- 02_storage.sql
-- 檔案空間 chat-files:單檔 5 MB、只有匿名登入者能上傳、擋掉可執行檔。
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行。
--
-- 檔案放置規則(前端依此命名,下面的規則會檢查):
--   <小時資料夾>/<自己的編號>-<隨機碼>.<副檔名>
--   例如 2026101309/0b1c...-3f2a....png
-- 以「小時資料夾」分類,清理時只要刪掉超過 24 小時的整個資料夾,
-- 不需要逐一查每個檔案的建立時間。

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', true, 5242880)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "signed-in users can upload chat files" on storage.objects;
create policy "signed-in users can upload chat files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-files'
    -- 第一層必須是「現在」或「上一個小時」(UTC),不能自己亂填時間讓檔案永遠不被清掉
    and (storage.foldername(name))[1] in (
      to_char(now() at time zone 'utc', 'YYYYMMDDHH24'),
      to_char((now() - interval '1 hour') at time zone 'utc', 'YYYYMMDDHH24')
    )
    -- 只有一層資料夾
    and array_length(storage.foldername(name), 1) = 1
    -- 檔名必須以自己的編號開頭
    and storage.filename(name) like (auth.uid()::text || '-%')
    -- 擋掉可執行檔
    and lower(storage.extension(name)) <> all (array[
      'exe','bat','cmd','com','msi','scr','sh','ps1','vbs','js','jar',
      'apk','app','dll','lnk','reg','wsf','hta','cpl','pif','gadget'
    ])
  );

-- 不開放使用者修改或刪除檔案;公開的 bucket 讀取檔案不需要額外規則
