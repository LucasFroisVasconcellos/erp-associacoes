-- 0037: PDF até 50 MB (estatuto e atas escaneados costumam passar de 10 MB).
-- 50 MB é o máximo por arquivo do Supabase no plano gratuito. O limite do bucket é o teto;
-- a função enviar-arquivo continua segurando fotos, XML e planilhas em 10 MB (confere pelos bytes).
update storage.buckets set file_size_limit = 52428800
where id in ('comprovantes', 'contador', 'pessoas', 'saude', 'institucional', 'captacao');
