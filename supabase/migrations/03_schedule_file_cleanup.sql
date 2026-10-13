-- 03_schedule_file_cleanup.sql
-- 每小時呼叫一次 cleanup-files 小程式,刪除超過 24 小時的檔案。
-- 請「先部署 cleanup-files」,再執行這一段。
--
-- 這裡用的是公開金鑰(Publishable key),它本來就公開,不是秘密。
-- 小程式需要的管理員權限由 Supabase 自動提供給它,不需要在這裡放任何秘密金鑰。

create extension if not exists pg_net;

select cron.schedule(
  'cleanup-files',
  '10 * * * *',
  $$
  select net.http_post(
    url := 'https://zxfisnlciqqizakgjzvb.supabase.co/functions/v1/cleanup-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_sAO-Ozz8zyL2HNFejLY7YQ_V1tGMRGB'
    ),
    body := '{}'::jsonb
  );
  $$
);
